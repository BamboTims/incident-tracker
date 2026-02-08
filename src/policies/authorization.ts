import { AppError } from '../errors/app-error.js';
import type { OrgRole } from '../repositories/tenant-repository.js';

export const INCIDENT_ROLES = ['IC', 'CL', 'OL', 'SME'] as const;

export type IncidentRole = (typeof INCIDENT_ROLES)[number];

export const POLICY_ACTIONS = [
  'tenant.read',
  'tenant.update_settings',
  'members.invite',
  'members.remove',
  'members.change_role',
  'services.create',
  'services.update',
  'services.archive',
  'incidents.create',
  'incidents.read',
  'incidents.update',
  'incidents.change_severity',
  'incidents.resolve',
  'incidents.close',
  'incidents.assign_incident_roles',
  'timeline.add_event',
  'updates.publish_internal',
  'updates.publish_external',
  'tasks.create',
  'tasks.assign',
  'postmortems.create',
  'postmortems.edit',
  'postmortems.publish',
  'api_keys.manage',
  'webhooks.manage',
  'audit_log.read',
  'exports.create',
  'billing.read',
  'billing.manage_plan'
] as const;

export type PolicyAction = (typeof POLICY_ACTIONS)[number];

export interface AuthorizationContext {
  userId: string;
  tenantId: string;
  orgRoles: readonly OrgRole[];
}

export interface AuthorizationResourceContext {
  incidentRoles?: readonly IncidentRole[];
}

interface PolicyRule {
  allowedRoles: readonly OrgRole[];
  responderIncidentRoles?: readonly IncidentRole[];
}

interface AuthorizationDecision {
  allowed: boolean;
  reason?: string;
}

const POLICY_RULES: Record<PolicyAction, PolicyRule> = {
  'tenant.read': { allowedRoles: ['Owner', 'Admin', 'Responder', 'Viewer', 'Billing'] },
  'tenant.update_settings': { allowedRoles: ['Owner', 'Admin'] },
  'members.invite': { allowedRoles: ['Owner', 'Admin'] },
  'members.remove': { allowedRoles: ['Owner', 'Admin'] },
  'members.change_role': { allowedRoles: ['Owner', 'Admin'] },
  'services.create': { allowedRoles: ['Owner', 'Admin', 'Responder'] },
  'services.update': { allowedRoles: ['Owner', 'Admin', 'Responder'] },
  'services.archive': { allowedRoles: ['Owner', 'Admin', 'Responder'] },
  'incidents.create': { allowedRoles: ['Owner', 'Admin', 'Responder'] },
  'incidents.read': { allowedRoles: ['Owner', 'Admin', 'Responder', 'Viewer'] },
  'incidents.update': { allowedRoles: ['Owner', 'Admin', 'Responder'] },
  'incidents.change_severity': { allowedRoles: ['Owner', 'Admin', 'Responder'] },
  'incidents.resolve': { allowedRoles: ['Owner', 'Admin', 'Responder'] },
  'incidents.close': { allowedRoles: ['Owner', 'Admin', 'Responder'] },
  'incidents.assign_incident_roles': {
    allowedRoles: ['Owner', 'Admin', 'Responder'],
    responderIncidentRoles: ['IC']
  },
  'timeline.add_event': { allowedRoles: ['Owner', 'Admin', 'Responder'] },
  'updates.publish_internal': { allowedRoles: ['Owner', 'Admin', 'Responder'] },
  'updates.publish_external': {
    allowedRoles: ['Owner', 'Admin', 'Responder'],
    responderIncidentRoles: ['IC', 'CL']
  },
  'tasks.create': { allowedRoles: ['Owner', 'Admin', 'Responder'] },
  'tasks.assign': { allowedRoles: ['Owner', 'Admin', 'Responder'] },
  'postmortems.create': { allowedRoles: ['Owner', 'Admin', 'Responder'] },
  'postmortems.edit': { allowedRoles: ['Owner', 'Admin', 'Responder'] },
  'postmortems.publish': {
    allowedRoles: ['Owner', 'Admin', 'Responder'],
    responderIncidentRoles: ['IC']
  },
  'api_keys.manage': { allowedRoles: ['Owner', 'Admin'] },
  'webhooks.manage': { allowedRoles: ['Owner', 'Admin'] },
  'audit_log.read': { allowedRoles: ['Owner', 'Admin', 'Responder'] },
  'exports.create': { allowedRoles: ['Owner', 'Admin'] },
  'billing.read': { allowedRoles: ['Owner', 'Billing'] },
  'billing.manage_plan': { allowedRoles: ['Owner', 'Billing'] }
};

function hasRequiredIncidentRole(
  role: OrgRole,
  rule: PolicyRule,
  resource?: AuthorizationResourceContext
): boolean {
  if (role !== 'Responder') {
    return true;
  }

  if (rule.responderIncidentRoles === undefined) {
    return true;
  }

  const incidentRoles = resource?.incidentRoles;
  if (incidentRoles === undefined || incidentRoles.length === 0) {
    return false;
  }

  return incidentRoles.some((incidentRole) => rule.responderIncidentRoles?.includes(incidentRole) ?? false);
}

export function authorize(
  action: PolicyAction,
  context: AuthorizationContext,
  resource?: AuthorizationResourceContext
): AuthorizationDecision {
  const rule = POLICY_RULES[action];

  for (const role of context.orgRoles) {
    if (!rule.allowedRoles.includes(role)) {
      continue;
    }

    if (hasRequiredIncidentRole(role, rule, resource)) {
      return { allowed: true };
    }
  }

  return {
    allowed: false,
    reason: `Missing permission for action '${action}'.`
  };
}

export function assertAuthorized(
  action: PolicyAction,
  context: AuthorizationContext,
  resource?: AuthorizationResourceContext
): void {
  const decision = authorize(action, context, resource);

  if (!decision.allowed) {
    throw new AppError(403, 'PERMISSION_DENIED', decision.reason ?? 'Permission denied.');
  }
}