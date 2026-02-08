import { randomUUID } from 'node:crypto';

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

function cloneTenant(tenant: Tenant): Tenant {
  return {
    ...tenant,
    createdAt: new Date(tenant.createdAt),
    updatedAt: new Date(tenant.updatedAt)
  };
}

function cloneMembership(membership: Membership): Membership {
  return {
    ...membership,
    createdAt: new Date(membership.createdAt),
    updatedAt: new Date(membership.updatedAt)
  };
}

function cloneInvite(invite: TenantInvite): TenantInvite {
  return {
    ...invite,
    expiresAt: new Date(invite.expiresAt),
    acceptedAt: invite.acceptedAt === null ? null : new Date(invite.acceptedAt),
    createdAt: new Date(invite.createdAt)
  };
}

function membershipKey(tenantId: string, userId: string): string {
  return `${tenantId}:${userId}`;
}

export class InMemoryTenantRepository implements TenantRepository {
  private readonly tenantsById = new Map<string, Tenant>();

  private readonly tenantIdsBySlug = new Map<string, string>();

  private readonly membershipsByKey = new Map<string, Membership>();

  private readonly invitesById = new Map<string, TenantInvite>();

  private readonly inviteIdsByTokenHash = new Map<string, string>();

  public createTenantWithOwner(input: CreateTenantInput): Promise<TenantMembershipRecord> {
    if (this.tenantIdsBySlug.has(input.slug)) {
      throw new Error('Tenant slug already exists.');
    }

    const now = new Date();
    const tenant: Tenant = {
      id: randomUUID(),
      name: input.name,
      slug: input.slug,
      createdByUserId: input.ownerUserId,
      createdAt: now,
      updatedAt: now
    };

    const membership: Membership = {
      id: randomUUID(),
      tenantId: tenant.id,
      userId: input.ownerUserId,
      role: 'Owner',
      createdAt: now,
      updatedAt: now
    };

    this.tenantsById.set(tenant.id, tenant);
    this.tenantIdsBySlug.set(tenant.slug, tenant.id);
    this.membershipsByKey.set(membershipKey(tenant.id, input.ownerUserId), membership);

    return Promise.resolve({
      tenant: cloneTenant(tenant),
      membership: cloneMembership(membership)
    });
  }

  public listMembershipsForUser(userId: string): Promise<TenantMembershipRecord[]> {
    const records: TenantMembershipRecord[] = [];

    for (const membership of this.membershipsByKey.values()) {
      if (membership.userId !== userId) {
        continue;
      }

      const tenant = this.tenantsById.get(membership.tenantId);
      if (tenant === undefined) {
        continue;
      }

      records.push({
        tenant: cloneTenant(tenant),
        membership: cloneMembership(membership)
      });
    }

    records.sort((left, right) => left.tenant.name.localeCompare(right.tenant.name));
    return Promise.resolve(records);
  }

  public getMembership(tenantId: string, userId: string): Promise<Membership | null> {
    const membership = this.membershipsByKey.get(membershipKey(tenantId, userId));
    return Promise.resolve(membership === undefined ? null : cloneMembership(membership));
  }

  public createInvite(input: CreateInviteInput): Promise<TenantInvite> {
    const invite: TenantInvite = {
      id: randomUUID(),
      tenantId: input.tenantId,
      email: input.email.toLowerCase(),
      role: input.role,
      tokenHash: input.tokenHash,
      invitedByUserId: input.invitedByUserId,
      expiresAt: input.expiresAt,
      acceptedAt: null,
      acceptedByUserId: null,
      createdAt: new Date()
    };

    this.invitesById.set(invite.id, invite);
    this.inviteIdsByTokenHash.set(invite.tokenHash, invite.id);

    return Promise.resolve(cloneInvite(invite));
  }

  public acceptInvite(input: AcceptInviteInput): Promise<AcceptInviteResult | null> {
    const inviteId = this.inviteIdsByTokenHash.get(input.tokenHash);
    if (inviteId === undefined) {
      return Promise.resolve(null);
    }

    const invite = this.invitesById.get(inviteId);
    if (invite === undefined) {
      return Promise.resolve(null);
    }

    if (invite.acceptedAt !== null || invite.expiresAt.getTime() < input.now.getTime()) {
      return Promise.resolve(null);
    }

    if (invite.email.toLowerCase() !== input.userEmail.toLowerCase()) {
      return Promise.resolve(null);
    }

    const tenant = this.tenantsById.get(invite.tenantId);
    if (tenant === undefined) {
      return Promise.resolve(null);
    }

    invite.acceptedAt = new Date(input.now);
    invite.acceptedByUserId = input.userId;

    const key = membershipKey(invite.tenantId, input.userId);
    const existingMembership = this.membershipsByKey.get(key);
    const now = new Date(input.now);

    const membership: Membership = existingMembership === undefined
      ? {
          id: randomUUID(),
          tenantId: invite.tenantId,
          userId: input.userId,
          role: invite.role,
          createdAt: now,
          updatedAt: now
        }
      : {
          ...existingMembership,
          role: invite.role,
          updatedAt: now
        };

    this.membershipsByKey.set(key, membership);
    this.invitesById.set(invite.id, invite);

    return Promise.resolve({
      tenant: cloneTenant(tenant),
      membership: cloneMembership(membership),
      invite: cloneInvite(invite)
    });
  }
}