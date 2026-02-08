import argon2 from 'argon2';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppRuntime } from '../../src/app.js';
import { InMemoryAuditLogRepository } from '../../src/repositories/in-memory-audit-log-repository.js';
import { createTestRuntime } from '../helpers/create-test-runtime.js';

interface AuthStateResponse {
  csrfToken: string;
}

interface LoginResponse {
  csrfToken: string;
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

async function seedUser(runtime: AppRuntime, email: string, password: string): Promise<string> {
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1
  });

  const user = await runtime.authRepository.createUser({
    email,
    passwordHash
  });

  return user.id;
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

describe('audit log integration', () => {
  let runtime: AppRuntime;

  beforeEach(async () => {
    runtime = await createTestRuntime();
  });

  afterEach(async () => {
    await runtime.close();
  });

  it('records audit events for sensitive auth, tenant, and incident actions', async () => {
    const userId = await seedUser(runtime, 'owner@example.com', 'OwnerPassword123!');
    const ownerAgent = request.agent(runtime.app);

    const loginCsrf = await login(ownerAgent, 'owner@example.com', 'OwnerPassword123!');

    const tenantCreateResponse = await ownerAgent
      .post('/v1/tenants')
      .set('x-csrf-token', loginCsrf)
      .send({ name: 'Audit Tenant' });

    expect(tenantCreateResponse.status).toBe(201);
    const tenant = tenantCreateResponse.body as TenantCreateResponse;

    const createIncidentResponse = await ownerAgent
      .post('/v1/incidents')
      .set('x-csrf-token', tenant.csrfToken)
      .send({
        title: 'Audit test incident',
        description: 'Testing audit stream',
        severity: 'SEV3',
        startTime: new Date().toISOString(),
        impactedServices: ['api']
      });

    expect(createIncidentResponse.status).toBe(201);
    const incident = createIncidentResponse.body as IncidentResponse;

    const updateIncidentResponse = await ownerAgent
      .patch(`/v1/incidents/${incident.incident.id}`)
      .set('x-csrf-token', incident.csrfToken)
      .send({ status: 'investigating' });

    expect(updateIncidentResponse.status).toBe(200);
    const logoutResponse = await ownerAgent
      .post('/v1/auth/logout')
      .set('x-csrf-token', (updateIncidentResponse.body as { csrfToken: string }).csrfToken)
      .send({});

    expect(logoutResponse.status).toBe(204);

    const auditRepository = runtime.auditLogRepository;
    if (!(auditRepository instanceof InMemoryAuditLogRepository)) {
      throw new Error('Expected in-memory audit repository for integration test.');
    }

    const events = auditRepository.listEvents();
    const actions = events.map((event) => event.action);

    expect(actions).toEqual(expect.arrayContaining([
      'auth.login',
      'tenant.created',
      'incident.created',
      'incident.updated',
      'auth.logout'
    ]));

    const actorEvents = events.filter((event) => event.actorUserId === userId);
    expect(actorEvents.length).toBeGreaterThanOrEqual(5);

    for (const event of events) {
      expect(event.createdAt instanceof Date).toBe(true);
      expect(event.action.length).toBeGreaterThan(0);
    }
  });
});
