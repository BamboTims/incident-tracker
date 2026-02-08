import argon2 from 'argon2';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppRuntime } from '../../src/app.js';
import { createTestRuntime } from '../helpers/create-test-runtime.js';

interface AuthStateResponse {
  authenticated: boolean;
  csrfToken: string;
}

interface ErrorResponse {
  code: string;
}

interface LoginResponse {
  authenticated: boolean;
  csrfToken: string;
  user: {
    id: string;
    email: string;
  };
}

interface TenantCreateResponse {
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  membership: {
    id: string;
    tenantId: string;
    userId: string;
    role: string;
  };
  activeTenantId: string;
  csrfToken: string;
}

interface TenantListResponse {
  activeTenantId: string | null;
  tenants: Array<{
    tenant: {
      id: string;
      name: string;
      slug: string;
    };
    membership: {
      id: string;
      role: string;
    };
  }>;
  csrfToken: string;
}

interface InviteCreateResponse {
  invite: {
    id: string;
    tenantId: string;
    email: string;
    role: string;
  };
  inviteToken?: string;
  csrfToken: string;
}

interface InviteAcceptResponse {
  tenant: {
    id: string;
    name: string;
  };
  membership: {
    id: string;
    tenantId: string;
    userId: string;
    role: string;
  };
  activeTenantId: string;
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

async function getCsrfToken(agent: request.Agent): Promise<string> {
  const response = await agent.get('/v1/auth/me');
  expect(response.status).toBe(200);
  return (response.body as AuthStateResponse).csrfToken;
}

async function login(agent: request.Agent, email: string, password: string): Promise<string> {
  const csrfToken = await getCsrfToken(agent);
  const response = await agent
    .post('/v1/auth/login')
    .set('x-csrf-token', csrfToken)
    .send({ email, password });

  expect(response.status).toBe(200);
  expect((response.body as LoginResponse).authenticated).toBe(true);
  return (response.body as LoginResponse).csrfToken;
}

describe('tenant integration', () => {
  let runtime: AppRuntime;

  beforeEach(async () => {
    runtime = await createTestRuntime();
  });

  afterEach(async () => {
    await runtime.close();
  });

  it('creates a tenant and allows owner to list it', async () => {
    await seedUser(runtime, 'owner@example.com', 'StrongOwnerPassword123!');

    const ownerAgent = request.agent(runtime.app);
    const loginCsrf = await login(ownerAgent, 'owner@example.com', 'StrongOwnerPassword123!');

    const createResponse = await ownerAgent
      .post('/v1/tenants')
      .set('x-csrf-token', loginCsrf)
      .send({ name: 'Acme Platform' });

    expect(createResponse.status).toBe(201);
    const created = createResponse.body as TenantCreateResponse;
    expect(created.tenant.name).toBe('Acme Platform');
    expect(created.membership.role).toBe('Owner');
    expect(created.activeTenantId).toBe(created.tenant.id);

    const listResponse = await ownerAgent.get('/v1/tenants');
    expect(listResponse.status).toBe(200);

    const listed = listResponse.body as TenantListResponse;
    expect(listed.activeTenantId).toBe(created.tenant.id);
    expect(listed.tenants.length).toBe(1);
    expect(listed.tenants[0]?.tenant.id).toBe(created.tenant.id);
    expect(listed.tenants[0]?.membership.role).toBe('Owner');
  });

  it('blocks tenant switching when user is not a member', async () => {
    await seedUser(runtime, 'owner@example.com', 'StrongOwnerPassword123!');
    await seedUser(runtime, 'outsider@example.com', 'StrongOutsiderPassword123!');

    const ownerAgent = request.agent(runtime.app);
    const outsiderAgent = request.agent(runtime.app);

    const ownerCsrf = await login(ownerAgent, 'owner@example.com', 'StrongOwnerPassword123!');
    const createResponse = await ownerAgent
      .post('/v1/tenants')
      .set('x-csrf-token', ownerCsrf)
      .send({ name: 'Secure Workspace' });

    expect(createResponse.status).toBe(201);
    const tenantId = (createResponse.body as TenantCreateResponse).tenant.id;

    const outsiderCsrf = await login(outsiderAgent, 'outsider@example.com', 'StrongOutsiderPassword123!');
    const switchResponse = await outsiderAgent
      .post(`/v1/tenants/${tenantId}/switch`)
      .set('x-csrf-token', outsiderCsrf)
      .send({});

    expect(switchResponse.status).toBe(404);
    expect((switchResponse.body as ErrorResponse).code).toBe('TENANT_NOT_FOUND');
  });

  it('invites and accepts membership with role constraints', async () => {
    await seedUser(runtime, 'owner@example.com', 'StrongOwnerPassword123!');
    await seedUser(runtime, 'responder@example.com', 'StrongResponderPassword123!');

    const ownerAgent = request.agent(runtime.app);
    const responderAgent = request.agent(runtime.app);

    const ownerCsrf = await login(ownerAgent, 'owner@example.com', 'StrongOwnerPassword123!');

    const createTenantResponse = await ownerAgent
      .post('/v1/tenants')
      .set('x-csrf-token', ownerCsrf)
      .send({ name: 'Incident Ops' });

    expect(createTenantResponse.status).toBe(201);
    const createdTenant = createTenantResponse.body as TenantCreateResponse;

    const inviteResponse = await ownerAgent
      .post(`/v1/tenants/${createdTenant.tenant.id}/invites`)
      .set('x-csrf-token', createdTenant.csrfToken)
      .send({
        email: 'responder@example.com',
        role: 'Responder'
      });

    expect(inviteResponse.status).toBe(201);
    const inviteBody = inviteResponse.body as InviteCreateResponse;
    expect(typeof inviteBody.inviteToken).toBe('string');

    if (typeof inviteBody.inviteToken !== 'string') {
      throw new Error('Invite token must be exposed in test mode.');
    }

    const responderCsrf = await login(responderAgent, 'responder@example.com', 'StrongResponderPassword123!');

    const acceptResponse = await responderAgent
      .post('/v1/tenants/invites/accept')
      .set('x-csrf-token', responderCsrf)
      .send({ token: inviteBody.inviteToken });

    expect(acceptResponse.status).toBe(200);
    const accepted = acceptResponse.body as InviteAcceptResponse;
    expect(accepted.tenant.id).toBe(createdTenant.tenant.id);
    expect(accepted.membership.role).toBe('Responder');
    expect(accepted.activeTenantId).toBe(createdTenant.tenant.id);

    const responderInviteAttempt = await responderAgent
      .post(`/v1/tenants/${createdTenant.tenant.id}/invites`)
      .set('x-csrf-token', accepted.csrfToken)
      .send({
        email: 'newuser@example.com',
        role: 'Viewer'
      });

    expect(responderInviteAttempt.status).toBe(403);
    expect((responderInviteAttempt.body as ErrorResponse).code).toBe('PERMISSION_DENIED');
  });
});