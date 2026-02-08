import { createHash, randomBytes } from 'node:crypto';

import { AppError } from '../errors/app-error.js';
import { assertAuthorized } from '../policies/authorization.js';
import type { AuthRepository } from '../repositories/auth-repository.js';
import type {
  Membership,
  OrgRole,
  TenantMembershipRecord,
  TenantRepository,
  TenantInvite
} from '../repositories/tenant-repository.js';

export interface TenantServiceConfig {
  inviteTokenTtlHours: number;
}

export interface TenantInviteResult {
  invite: TenantInvite;
  inviteToken: string;
}

function slugifyTenantName(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  const base = normalized.length > 0 ? normalized : 'tenant';
  const suffix = randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function membershipContext(membership: Membership) {
  return {
    userId: membership.userId,
    tenantId: membership.tenantId,
    orgRoles: [membership.role] as const
  };
}

export class TenantService {
  public constructor(
    private readonly tenantRepository: TenantRepository,
    private readonly authRepository: AuthRepository,
    private readonly config: TenantServiceConfig
  ) {}

  public async createTenant(ownerUserId: string, name: string): Promise<TenantMembershipRecord> {
    const normalizedName = name.trim();
    if (normalizedName.length < 3) {
      throw new AppError(400, 'TENANT_NAME_INVALID', 'Tenant name must be at least 3 characters long.');
    }

    return this.tenantRepository.createTenantWithOwner({
      name: normalizedName,
      slug: slugifyTenantName(normalizedName),
      ownerUserId
    });
  }

  public listUserTenants(userId: string): Promise<TenantMembershipRecord[]> {
    return this.tenantRepository.listMembershipsForUser(userId);
  }

  public async switchActiveTenant(userId: string, tenantId: string): Promise<Membership> {
    const membership = await this.tenantRepository.getMembership(tenantId, userId);
    if (membership === null) {
      throw new AppError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
    }

    assertAuthorized('tenant.read', membershipContext(membership));
    return membership;
  }

  public async createInvite(invitedByUserId: string, tenantId: string, email: string, role: OrgRole): Promise<TenantInviteResult> {
    const membership = await this.tenantRepository.getMembership(tenantId, invitedByUserId);
    if (membership === null) {
      throw new AppError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
    }

    assertAuthorized('members.invite', membershipContext(membership));

    const normalizedEmail = email.trim().toLowerCase();
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);

    const invite = await this.tenantRepository.createInvite({
      tenantId,
      email: normalizedEmail,
      role,
      invitedByUserId,
      tokenHash,
      expiresAt: new Date(Date.now() + this.config.inviteTokenTtlHours * 60 * 60 * 1_000)
    });

    return {
      invite,
      inviteToken: token
    };
  }

  public async acceptInvite(userId: string, token: string): Promise<TenantMembershipRecord> {
    const user = await this.authRepository.findUserById(userId);
    if (user === null) {
      throw new AppError(401, 'AUTH_REQUIRED', 'Authentication is required.');
    }

    const result = await this.tenantRepository.acceptInvite({
      tokenHash: hashToken(token),
      userId,
      userEmail: user.email,
      now: new Date()
    });

    if (result === null) {
      throw new AppError(400, 'INVITE_INVALID', 'Invite token is invalid, expired, or already accepted.');
    }

    return {
      tenant: result.tenant,
      membership: result.membership
    };
  }
}
