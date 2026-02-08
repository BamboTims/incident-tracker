import { describe, expect, it } from 'vitest';

import { AppError } from '../../src/errors/app-error.js';
import { assertAuthorized, authorize } from '../../src/policies/authorization.js';

describe('authorization policy matrix', () => {
  it('allows owner to invite members', () => {
    const decision = authorize('members.invite', {
      userId: 'user-1',
      tenantId: 'tenant-1',
      orgRoles: ['Owner']
    });

    expect(decision.allowed).toBe(true);
  });

  it('denies responder from inviting members', () => {
    const decision = authorize('members.invite', {
      userId: 'user-1',
      tenantId: 'tenant-1',
      orgRoles: ['Responder']
    });

    expect(decision.allowed).toBe(false);
  });

  it('requires IC or CL incident role for responder external updates', () => {
    const denied = authorize(
      'updates.publish_external',
      {
        userId: 'user-1',
        tenantId: 'tenant-1',
        orgRoles: ['Responder']
      },
      {
        incidentRoles: ['SME']
      }
    );

    const allowed = authorize(
      'updates.publish_external',
      {
        userId: 'user-1',
        tenantId: 'tenant-1',
        orgRoles: ['Responder']
      },
      {
        incidentRoles: ['CL']
      }
    );

    expect(denied.allowed).toBe(false);
    expect(allowed.allowed).toBe(true);
  });

  it('allows viewer to read tenant but not update tenant settings', () => {
    const readDecision = authorize('tenant.read', {
      userId: 'user-1',
      tenantId: 'tenant-1',
      orgRoles: ['Viewer']
    });

    const updateDecision = authorize('tenant.update_settings', {
      userId: 'user-1',
      tenantId: 'tenant-1',
      orgRoles: ['Viewer']
    });

    expect(readDecision.allowed).toBe(true);
    expect(updateDecision.allowed).toBe(false);
  });

  it('assertAuthorized throws AppError for denied actions', () => {
    expect(() => {
      assertAuthorized('billing.manage_plan', {
        userId: 'user-1',
        tenantId: 'tenant-1',
        orgRoles: ['Responder']
      });
    }).toThrowError(AppError);
  });
});