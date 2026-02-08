import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type {
  AcceptInviteInput,
  AcceptInviteResult,
  CreateInviteInput,
  CreateTenantInput,
  Membership,
  Tenant,
  TenantInvite,
  TenantMembershipRecord,
  TenantRepository
} from './tenant-repository.js';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
}

interface MembershipRow {
  id: string;
  tenant_id: string;
  user_id: string;
  role: Membership['role'];
  created_at: Date;
  updated_at: Date;
}

interface InviteRow {
  id: string;
  tenant_id: string;
  email: string;
  role: Membership['role'];
  token_hash: string;
  invited_by_user_id: string;
  expires_at: Date;
  accepted_at: Date | null;
  accepted_by_user_id: string | null;
  created_at: Date;
}

interface MembershipListRow extends MembershipRow {
  tenant_name: string;
  tenant_slug: string;
  tenant_created_by_user_id: string;
  tenant_created_at: Date;
  tenant_updated_at: Date;
}

function mapTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMembership(row: MembershipRow): Membership {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapInvite(row: InviteRow): TenantInvite {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    role: row.role,
    tokenHash: row.token_hash,
    invitedByUserId: row.invited_by_user_id,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    acceptedByUserId: row.accepted_by_user_id,
    createdAt: row.created_at
  };
}

function getSingleRow<T>(rows: T[]): T | null {
  const [row] = rows;
  return row ?? null;
}

async function setLocal(client: PoolClient, key: string, value: string): Promise<void> {
  await client.query('SELECT set_config($1, $2, true)', [key, value]);
}

async function withTransaction<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresTenantRepository implements TenantRepository {
  public constructor(private readonly pool: Pool) {}

  public async createTenantWithOwner(input: CreateTenantInput): Promise<TenantMembershipRecord> {
    return withTransaction(this.pool, async (client) => {
      const tenantId = randomUUID();
      const now = new Date();

      const tenantResult = await client.query<TenantRow>(
        `
        INSERT INTO tenants (
          id,
          name,
          slug,
          created_by_user_id,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $5)
        RETURNING *
        `,
        [tenantId, input.name, input.slug, input.ownerUserId, now]
      );

      const tenantRow = getSingleRow(tenantResult.rows);
      if (tenantRow === null) {
        throw new Error('Failed to create tenant.');
      }

      await setLocal(client, 'app.tenant_id', tenantId);
      await setLocal(client, 'app.user_id', input.ownerUserId);

      const membershipResult = await client.query<MembershipRow>(
        `
        INSERT INTO memberships (
          id,
          tenant_id,
          user_id,
          role,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, 'Owner', $4, $4)
        RETURNING *
        `,
        [randomUUID(), tenantId, input.ownerUserId, now]
      );

      const membershipRow = getSingleRow(membershipResult.rows);
      if (membershipRow === null) {
        throw new Error('Failed to create owner membership.');
      }

      return {
        tenant: mapTenant(tenantRow),
        membership: mapMembership(membershipRow)
      };
    });
  }

  public async listMembershipsForUser(userId: string): Promise<TenantMembershipRecord[]> {
    return withTransaction(this.pool, async (client) => {
      await setLocal(client, 'app.user_id', userId);

      const result = await client.query<MembershipListRow>(
        `
        SELECT
          m.id,
          m.tenant_id,
          m.user_id,
          m.role,
          m.created_at,
          m.updated_at,
          t.name AS tenant_name,
          t.slug AS tenant_slug,
          t.created_by_user_id AS tenant_created_by_user_id,
          t.created_at AS tenant_created_at,
          t.updated_at AS tenant_updated_at
        FROM memberships m
        INNER JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = $1
        ORDER BY t.name ASC
        `,
        [userId]
      );

      return result.rows.map((row) => ({
        tenant: {
          id: row.tenant_id,
          name: row.tenant_name,
          slug: row.tenant_slug,
          createdByUserId: row.tenant_created_by_user_id,
          createdAt: row.tenant_created_at,
          updatedAt: row.tenant_updated_at
        },
        membership: mapMembership(row)
      }));
    });
  }

  public async getMembership(tenantId: string, userId: string): Promise<Membership | null> {
    return withTransaction(this.pool, async (client) => {
      await setLocal(client, 'app.tenant_id', tenantId);
      await setLocal(client, 'app.user_id', userId);

      const result = await client.query<MembershipRow>(
        `
        SELECT *
        FROM memberships
        WHERE tenant_id = $1 AND user_id = $2
        LIMIT 1
        `,
        [tenantId, userId]
      );

      const row = getSingleRow(result.rows);
      return row === null ? null : mapMembership(row);
    });
  }

  public async createInvite(input: CreateInviteInput): Promise<TenantInvite> {
    return withTransaction(this.pool, async (client) => {
      await setLocal(client, 'app.tenant_id', input.tenantId);
      await setLocal(client, 'app.user_id', input.invitedByUserId);

      const result = await client.query<InviteRow>(
        `
        INSERT INTO tenant_invites (
          id,
          tenant_id,
          email,
          role,
          token_hash,
          invited_by_user_id,
          expires_at,
          accepted_at,
          accepted_by_user_id,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, NOW())
        RETURNING *
        `,
        [
          randomUUID(),
          input.tenantId,
          input.email.toLowerCase(),
          input.role,
          input.tokenHash,
          input.invitedByUserId,
          input.expiresAt
        ]
      );

      const row = getSingleRow(result.rows);
      if (row === null) {
        throw new Error('Failed to create tenant invite.');
      }

      return mapInvite(row);
    });
  }

  public async acceptInvite(input: AcceptInviteInput): Promise<AcceptInviteResult | null> {
    return withTransaction(this.pool, async (client) => {
      const normalizedEmail = input.userEmail.toLowerCase();
      await setLocal(client, 'app.user_email', normalizedEmail);

      const inviteResult = await client.query<InviteRow>(
        `
        SELECT *
        FROM tenant_invites
        WHERE token_hash = $1
          AND accepted_at IS NULL
          AND expires_at >= $2
        LIMIT 1
        `,
        [input.tokenHash, input.now]
      );

      const inviteRow = getSingleRow(inviteResult.rows);
      if (inviteRow === null) {
        return null;
      }

      if (inviteRow.email.toLowerCase() !== normalizedEmail) {
        return null;
      }

      await setLocal(client, 'app.tenant_id', inviteRow.tenant_id);
      await setLocal(client, 'app.user_id', input.userId);

      const tenantResult = await client.query<TenantRow>(
        `
        SELECT *
        FROM tenants
        WHERE id = $1
        LIMIT 1
        `,
        [inviteRow.tenant_id]
      );

      const tenantRow = getSingleRow(tenantResult.rows);
      if (tenantRow === null) {
        return null;
      }

      const membershipResult = await client.query<MembershipRow>(
        `
        INSERT INTO memberships (
          id,
          tenant_id,
          user_id,
          role,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $5)
        ON CONFLICT (tenant_id, user_id)
        DO UPDATE
          SET role = EXCLUDED.role,
              updated_at = EXCLUDED.updated_at
        RETURNING *
        `,
        [randomUUID(), inviteRow.tenant_id, input.userId, inviteRow.role, input.now]
      );

      const membershipRow = getSingleRow(membershipResult.rows);
      if (membershipRow === null) {
        throw new Error('Failed to create membership from invite.');
      }

      const acceptedInviteResult = await client.query<InviteRow>(
        `
        UPDATE tenant_invites
        SET accepted_at = $2,
            accepted_by_user_id = $3
        WHERE id = $1
        RETURNING *
        `,
        [inviteRow.id, input.now, input.userId]
      );

      const acceptedInviteRow = getSingleRow(acceptedInviteResult.rows);
      if (acceptedInviteRow === null) {
        throw new Error('Failed to mark invite as accepted.');
      }

      return {
        tenant: mapTenant(tenantRow),
        membership: mapMembership(membershipRow),
        invite: mapInvite(acceptedInviteRow)
      };
    });
  }
}