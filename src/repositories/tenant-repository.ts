export const ORG_ROLES = ['Owner', 'Admin', 'Responder', 'Viewer', 'Billing'] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Membership {
  id: string;
  tenantId: string;
  userId: string;
  role: OrgRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantInvite {
  id: string;
  tenantId: string;
  email: string;
  role: OrgRole;
  tokenHash: string;
  invitedByUserId: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
  createdAt: Date;
}

export interface CreateTenantInput {
  name: string;
  slug: string;
  ownerUserId: string;
}

export interface CreateInviteInput {
  tenantId: string;
  email: string;
  role: OrgRole;
  invitedByUserId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface AcceptInviteInput {
  tokenHash: string;
  userId: string;
  userEmail: string;
  now: Date;
}

export interface TenantMembershipRecord {
  tenant: Tenant;
  membership: Membership;
}

export interface AcceptInviteResult {
  tenant: Tenant;
  membership: Membership;
  invite: TenantInvite;
}

export interface TenantRepository {
  createTenantWithOwner(input: CreateTenantInput): Promise<TenantMembershipRecord>;
  listMembershipsForUser(userId: string): Promise<TenantMembershipRecord[]>;
  getMembership(tenantId: string, userId: string): Promise<Membership | null>;
  createInvite(input: CreateInviteInput): Promise<TenantInvite>;
  acceptInvite(input: AcceptInviteInput): Promise<AcceptInviteResult | null>;
}