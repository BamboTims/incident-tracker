import argon2 from 'argon2';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppRuntime } from '../../src/app.js';
import { createPostgresTestRuntime, resetPostgresState } from '../helpers/create-postgres-test-runtime.js';

const hasPostgres = Boolean(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL);

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

interface IncidentResponse {
  incident: {
    id: string;
  };
  csrfToken: string;
}

interface AuditLogResponse {
  events: Array<{
    action: string;
  }>;
  csrfToken: string;
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
  };
  secret: string;
  csrfToken: string;
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

describe.skipIf(!hasPostgres)('postgres integration (RLS and tenancy)', () => {
  let runtime: AppRuntime;

  beforeEach(async () => {
    await resetPostgresState();
    runtime = await createPostgresTestRuntime();
  });

  afterEach(async () => {
    await runtime.close();
  });

  it('enforces cross-tenant isolation for incidents and audit logs', async () => {
    await seedUser(runtime, 'owner@example.com', 'OwnerPassword123!');

    const ownerAgent = request.agent(runtime.app);
    const ownerCsrf = await login(ownerAgent, 'owner@example.com', 'OwnerPassword123!');

    const tenantAResponse = await ownerAgent
      .post('/v1/tenants')
      .set('x-csrf-token', ownerCsrf)
      .send({ name: 'Tenant A' });
    expect(tenantAResponse.status).toBe(201);
    const tenantA = tenantAResponse.body as TenantCreateResponse;

    const incidentAResponse = await ownerAgent
      .post('/v1/incidents')
      .set('x-csrf-token', tenantA.csrfToken)
      .send({
        title: 'Tenant A incident',
        description: 'A',
        severity: 'SEV2',
        startTime: new Date().toISOString(),
        impactedServices: ['api']
      });
    expect(incidentAResponse.status).toBe(201);
    const incidentA = incidentAResponse.body as IncidentResponse;

    const tenantBResponse = await ownerAgent
      .post('/v1/tenants')
      .set('x-csrf-token', incidentA.csrfToken)
      .send({ name: 'Tenant B' });
    expect(tenantBResponse.status).toBe(201);
    const tenantB = tenantBResponse.body as TenantCreateResponse;

    const listInB = await ownerAgent.get('/v1/incidents');
    expect(listInB.status).toBe(200);
    expect((listInB.body as { incidents: unknown[] }).incidents.length).toBe(0);

    const getAFromB = await ownerAgent.get(`/v1/incidents/${incidentA.incident.id}`);
    expect(getAFromB.status).toBe(404);
    expect((getAFromB.body as ErrorResponse).code).toBe('INCIDENT_NOT_FOUND');

    const auditInB = await ownerAgent.get('/v1/audit-logs');
    expect(auditInB.status).toBe(200);
    const auditBodyB = auditInB.body as AuditLogResponse;
    expect(auditBodyB.events.some((event) => event.action === 'incident.created')).toBe(false);

    const switchToA = await ownerAgent
      .post(`/v1/tenants/${tenantA.tenant.id}/switch`)
      .set('x-csrf-token', (auditInB.body as AuditLogResponse).csrfToken)
      .send({});
    expect(switchToA.status).toBe(200);

    const listInA = await ownerAgent.get('/v1/incidents');
    expect(listInA.status).toBe(200);
    expect((listInA.body as { incidents: unknown[] }).incidents.length).toBe(1);

    const auditInA = await ownerAgent.get('/v1/audit-logs');
    expect(auditInA.status).toBe(200);
    const auditBodyA = auditInA.body as AuditLogResponse;
    expect(auditBodyA.events.some((event) => event.action === 'incident.created')).toBe(true);

    const switchBackToB = await ownerAgent
      .post(`/v1/tenants/${tenantB.tenant.id}/switch`)
      .set('x-csrf-token', (auditInA.body as AuditLogResponse).csrfToken)
      .send({});
    expect(switchBackToB.status).toBe(200);
  });

  it('authenticates incident requests with API keys bound to tenant context', async () => {
    await seedUser(runtime, 'owner@example.com', 'OwnerPassword123!');

    const ownerAgent = request.agent(runtime.app);
    const ownerCsrf = await login(ownerAgent, 'owner@example.com', 'OwnerPassword123!');

    const tenantResponse = await ownerAgent
      .post('/v1/tenants')
      .set('x-csrf-token', ownerCsrf)
      .send({ name: 'Automation Tenant' });
    expect(tenantResponse.status).toBe(201);
    const tenant = tenantResponse.body as TenantCreateResponse;

    const serviceAccountResponse = await ownerAgent
      .post(`/v1/tenants/${tenant.tenant.id}/service-accounts`)
      .set('x-csrf-token', tenant.csrfToken)
      .send({ name: 'Automation SA' });
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
    const apiKey = apiKeyResponse.body as ApiKeyCreateResponse;
    const client = request(runtime.app);

    const createWithKey = await client
      .post('/v1/incidents')
      .set('x-api-key', apiKey.secret)
      .send({
        title: 'Automated incident',
        description: 'Created by API key',
        severity: 'SEV3',
        startTime: new Date().toISOString(),
        impactedServices: ['worker']
      });
    expect(createWithKey.status).toBe(201);

    const listWithKey = await client
      .get('/v1/incidents')
      .set('x-api-key', apiKey.secret);
    expect(listWithKey.status).toBe(200);
    expect((listWithKey.body as { incidents: unknown[] }).incidents.length).toBe(1);

    const revokeResponse = await ownerAgent
      .post(`/v1/tenants/${tenant.tenant.id}/api-keys/${apiKey.apiKey.id}/revoke`)
      .set('x-csrf-token', apiKey.csrfToken)
      .send({});
    expect(revokeResponse.status).toBe(200);

    const deniedAfterRevoke = await client
      .get('/v1/incidents')
      .set('x-api-key', apiKey.secret);
    expect(deniedAfterRevoke.status).toBe(401);
    expect((deniedAfterRevoke.body as ErrorResponse).code).toBe('AUTH_INVALID_API_KEY');
  });
});
