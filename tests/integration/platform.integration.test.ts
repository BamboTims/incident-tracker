import argon2 from 'argon2';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppRuntime } from '../../src/app.js';
import { createTestRuntime } from '../helpers/create-test-runtime.js';

interface AuthStateResponse {
  csrfToken: string;
}

interface LoginResponse {
  csrfToken: string;
}

interface ErrorResponse {
  code: string;
}

interface TenantCreateResponse {
  tenant: {
    id: string;
  };
  csrfToken: string;
}

interface InviteResponse {
  inviteToken?: string;
}

interface ServiceAccountResponse {
  serviceAccount: {
    id: string;
  };
  csrfToken: string;
}

interface ApiKeyCreateResponse {
  apiKey: {
    id: string;
    lastUsedAt: string | null;
  };
  secret: string;
  csrfToken: string;
}

interface ApiKeyListResponse {
  apiKeys: Array<{
    id: string;
    revokedAt: string | null;
    lastUsedAt: string | null;
  }>;
  csrfToken: string;
}

interface UsageResponse {
  usage: {
    used: number;
    limit: number;
    remaining: number;
  };
}

interface AuditLogListResponse {
  events: Array<{
    id: string;
    action: string;
  }>;
}

async function seedUser(runtime: AppRuntime, email: string, password: string): Promise<void> {
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1
  });

  await runtime.authRepository.createUser({
    email,
    passwordHash
  });
}

async function getCsrf(agent: request.Agent): Promise<string> {
  const response = await agent.get('/v1/auth/me');
  expect(response.status).toBe(200);
  return (response.body as AuthStateResponse).csrfToken;
}

async function login(agent: request.Agent, email: string, password: string): Promise<string> {
  const csrf = await getCsrf(agent);
  const response = await agent
    .post('/v1/auth/login')
    .set('x-csrf-token', csrf)
    .send({ email, password });

  expect(response.status).toBe(200);
  return (response.body as LoginResponse).csrfToken;
}

describe('platform integration', () => {
  let runtime: AppRuntime;

  beforeEach(async () => {
    runtime = await createTestRuntime();
  });

  afterEach(async () => {
    await runtime.close();
  });

  it('lists audit logs for privileged users and blocks viewer role', async () => {
    await seedUser(runtime, 'owner@example.com', 'OwnerPassword123!');
    await seedUser(runtime, 'viewer@example.com', 'ViewerPassword123!');

    const ownerAgent = request.agent(runtime.app);
    const viewerAgent = request.agent(runtime.app);

    const ownerCsrf = await login(ownerAgent, 'owner@example.com', 'OwnerPassword123!');
    const tenantResponse = await ownerAgent
      .post('/v1/tenants')
      .set('x-csrf-token', ownerCsrf)
      .send({ name: 'Audit Platform Tenant' });

    expect(tenantResponse.status).toBe(201);
    const tenant = tenantResponse.body as TenantCreateResponse;

    const incidentResponse = await ownerAgent
      .post('/v1/incidents')
      .set('x-csrf-token', tenant.csrfToken)
      .send({
        title: 'Audit visibility incident',
        description: 'Audit checks',
        severity: 'SEV3',
        startTime: new Date().toISOString(),
        impactedServices: ['api']
      });

    expect(incidentResponse.status).toBe(201);

    const ownerAuditResponse = await ownerAgent.get('/v1/audit-logs');
    expect(ownerAuditResponse.status).toBe(200);
    const ownerAudit = ownerAuditResponse.body as AuditLogListResponse;
    expect(ownerAudit.events.length).toBeGreaterThan(0);
    expect(ownerAudit.events.some((event) => event.action === 'tenant.created')).toBe(true);

    const inviteResponse = await ownerAgent
      .post(`/v1/tenants/${tenant.tenant.id}/invites`)
      .set('x-csrf-token', (incidentResponse.body as { csrfToken: string }).csrfToken)
      .send({
        email: 'viewer@example.com',
        role: 'Viewer'
      });

    expect(inviteResponse.status).toBe(201);
    const invite = inviteResponse.body as InviteResponse;
    if (typeof invite.inviteToken !== 'string') {
      throw new Error('Expected invite token in test mode.');
    }

    const viewerCsrf = await login(viewerAgent, 'viewer@example.com', 'ViewerPassword123!');
    const acceptResponse = await viewerAgent
      .post('/v1/tenants/invites/accept')
      .set('x-csrf-token', viewerCsrf)
      .send({ token: invite.inviteToken });

    expect(acceptResponse.status).toBe(200);

    const deniedAuditResponse = await viewerAgent.get('/v1/audit-logs');
    expect(deniedAuditResponse.status).toBe(403);
    expect((deniedAuditResponse.body as ErrorResponse).code).toBe('PERMISSION_DENIED');
  });

  it('supports API key auth path, updates last_used_at, and revokes keys', async () => {
    await seedUser(runtime, 'owner@example.com', 'OwnerPassword123!');

    const ownerAgent = request.agent(runtime.app);
    const ownerCsrf = await login(ownerAgent, 'owner@example.com', 'OwnerPassword123!');

    const tenantResponse = await ownerAgent
      .post('/v1/tenants')
      .set('x-csrf-token', ownerCsrf)
      .send({ name: 'API Key Tenant' });

    expect(tenantResponse.status).toBe(201);
    const tenant = tenantResponse.body as TenantCreateResponse;

    const serviceAccountResponse = await ownerAgent
      .post(`/v1/tenants/${tenant.tenant.id}/service-accounts`)
      .set('x-csrf-token', tenant.csrfToken)
      .send({ name: 'Automation Bot' });

    expect(serviceAccountResponse.status).toBe(201);
    const serviceAccount = serviceAccountResponse.body as ServiceAccountResponse;

    const apiKeyResponse = await ownerAgent
      .post(`/v1/tenants/${tenant.tenant.id}/api-keys`)
      .set('x-csrf-token', serviceAccount.csrfToken)
      .send({
        serviceAccountId: serviceAccount.serviceAccount.id,
        name: 'Automation Key',
        scopes: ['read', 'write']
      });

    expect(apiKeyResponse.status).toBe(201);
    const apiKeyCreated = apiKeyResponse.body as ApiKeyCreateResponse;
    expect(typeof apiKeyCreated.secret).toBe('string');

    const apiClient = request(runtime.app);
    const createIncidentWithKey = await apiClient
      .post('/v1/incidents')
      .set('x-api-key', apiKeyCreated.secret)
      .send({
        title: 'API key incident',
        description: 'Created through key auth',
        severity: 'SEV4',
        startTime: new Date().toISOString(),
        impactedServices: ['worker']
      });

    expect(createIncidentWithKey.status).toBe(201);

    const listIncidentsWithKey = await apiClient
      .get('/v1/incidents')
      .set('x-api-key', apiKeyCreated.secret);

    expect(listIncidentsWithKey.status).toBe(200);
    expect(Array.isArray((listIncidentsWithKey.body as { incidents: unknown[] }).incidents)).toBe(true);

    const apiKeyListResponse = await ownerAgent.get(`/v1/tenants/${tenant.tenant.id}/api-keys`);
    expect(apiKeyListResponse.status).toBe(200);
    const listed = apiKeyListResponse.body as ApiKeyListResponse;
    const listedRecord = listed.apiKeys.find((record) => record.id === apiKeyCreated.apiKey.id);
    expect(listedRecord?.lastUsedAt).not.toBeNull();

    const revokeResponse = await ownerAgent
      .post(`/v1/tenants/${tenant.tenant.id}/api-keys/${apiKeyCreated.apiKey.id}/revoke`)
      .set('x-csrf-token', listed.csrfToken)
      .send({});

    expect(revokeResponse.status).toBe(200);

    const deniedAfterRevoke = await apiClient
      .get('/v1/incidents')
      .set('x-api-key', apiKeyCreated.secret);

    expect(deniedAfterRevoke.status).toBe(401);
    expect((deniedAfterRevoke.body as ErrorResponse).code).toBe('AUTH_INVALID_API_KEY');
  });

  it('enforces daily write quota and exposes usage summary', async () => {
    await runtime.close();
    runtime = await createTestRuntime({
      envOverrides: {
        USAGE_DAILY_WRITE_LIMIT: 2
      }
    });

    await seedUser(runtime, 'owner@example.com', 'OwnerPassword123!');

    const ownerAgent = request.agent(runtime.app);
    const ownerCsrf = await login(ownerAgent, 'owner@example.com', 'OwnerPassword123!');

    const tenantResponse = await ownerAgent
      .post('/v1/tenants')
      .set('x-csrf-token', ownerCsrf)
      .send({ name: 'Quota Tenant' });

    expect(tenantResponse.status).toBe(201);
    const tenant = tenantResponse.body as TenantCreateResponse;

    const createOne = await ownerAgent
      .post('/v1/incidents')
      .set('x-csrf-token', tenant.csrfToken)
      .send({
        title: 'Quota one',
        description: 'First write',
        severity: 'SEV4',
        startTime: new Date().toISOString(),
        impactedServices: []
      });
    expect(createOne.status).toBe(201);

    const createTwo = await ownerAgent
      .post('/v1/incidents')
      .set('x-csrf-token', (createOne.body as { csrfToken: string }).csrfToken)
      .send({
        title: 'Quota two',
        description: 'Second write',
        severity: 'SEV4',
        startTime: new Date().toISOString(),
        impactedServices: []
      });
    expect(createTwo.status).toBe(201);

    const createThree = await ownerAgent
      .post('/v1/incidents')
      .set('x-csrf-token', (createTwo.body as { csrfToken: string }).csrfToken)
      .send({
        title: 'Quota three',
        description: 'Third write should fail',
        severity: 'SEV4',
        startTime: new Date().toISOString(),
        impactedServices: []
      });

    expect(createThree.status).toBe(429);
    expect((createThree.body as ErrorResponse).code).toBe('QUOTA_EXCEEDED');

    const usageResponse = await ownerAgent.get('/v1/usage');
    expect(usageResponse.status).toBe(200);
    const usageBody = usageResponse.body as UsageResponse;
    expect(usageBody.usage.limit).toBe(2);
    expect(usageBody.usage.used).toBe(2);
    expect(usageBody.usage.remaining).toBe(0);
  });
});
