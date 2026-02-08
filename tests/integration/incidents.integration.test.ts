import { randomUUID } from 'node:crypto';

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
  csrfToken: string;
}

interface IncidentResponse {
  incident: {
    id: string;
    status: string;
    severity: string;
  };
  csrfToken: string;
}

interface TaskResponse {
  task: {
    id: string;
    status: string;
  };
  csrfToken: string;
}

interface IncidentListResponse {
  incidents: Array<{
    id: string;
  }>;
  nextCursor: string | null;
  csrfToken: string;
}

interface TimelineListResponse {
  events: unknown[];
  csrfToken: string;
}

interface StatusUpdatesListResponse {
  updates: unknown[];
  csrfToken: string;
}

interface InviteAcceptResponse {
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

describe('incident integration', () => {
  let runtime: AppRuntime;

  beforeEach(async () => {
    runtime = await createTestRuntime();
  });

  afterEach(async () => {
    await runtime.close();
  });

  it('supports incident lifecycle operations for owner', async () => {
    await seedUser(runtime, 'owner@example.com', 'OwnerPassword123!');

    const ownerAgent = request.agent(runtime.app);
    const loginToken = await login(ownerAgent, 'owner@example.com', 'OwnerPassword123!');

    const tenantCreateResponse = await ownerAgent
      .post('/v1/tenants')
      .set('x-csrf-token', loginToken)
      .send({ name: 'Ops Tenant' });

    expect(tenantCreateResponse.status).toBe(201);
    const tenantCreated = tenantCreateResponse.body as TenantCreateResponse;

    const createIncidentResponse = await ownerAgent
      .post('/v1/incidents')
      .set('x-csrf-token', tenantCreated.csrfToken)
      .send({
        title: 'API outage',
        description: 'Production API elevated 5xx rate',
        severity: 'SEV2',
        startTime: new Date().toISOString(),
        impactedServices: ['api', 'worker']
      });

    expect(createIncidentResponse.status).toBe(201);
    const incidentCreated = createIncidentResponse.body as IncidentResponse;
    expect(incidentCreated.incident.status).toBe('declared');

    const incidentId = incidentCreated.incident.id;

    const listResponse = await ownerAgent.get('/v1/incidents');
    expect(listResponse.status).toBe(200);
    const listedIncidents = listResponse.body as IncidentListResponse;
    expect(Array.isArray(listedIncidents.incidents)).toBe(true);
    expect(listedIncidents.incidents.length).toBe(1);
    expect(listedIncidents.incidents[0]?.id).toBe(incidentId);

    const getResponse = await ownerAgent.get(`/v1/incidents/${incidentId}`);
    expect(getResponse.status).toBe(200);

    const updateResponse = await ownerAgent
      .patch(`/v1/incidents/${incidentId}`)
      .set('x-csrf-token', (getResponse.body as IncidentResponse).csrfToken)
      .send({
        status: 'investigating',
        severity: 'SEV1'
      });

    expect(updateResponse.status).toBe(200);
    expect((updateResponse.body as IncidentResponse).incident.status).toBe('investigating');
    expect((updateResponse.body as IncidentResponse).incident.severity).toBe('SEV1');

    const invalidTransitionResponse = await ownerAgent
      .patch(`/v1/incidents/${incidentId}`)
      .set('x-csrf-token', (updateResponse.body as IncidentResponse).csrfToken)
      .send({ status: 'closed' });

    expect(invalidTransitionResponse.status).toBe(400);
    expect((invalidTransitionResponse.body as ErrorResponse).code).toBe('INCIDENT_STATUS_TRANSITION_INVALID');

    const timelineResponse = await ownerAgent
      .post(`/v1/incidents/${incidentId}/timeline-events`)
      .set('x-csrf-token', (updateResponse.body as IncidentResponse).csrfToken)
      .send({
        eventTime: new Date().toISOString(),
        eventType: 'investigation',
        message: 'Started root cause analysis'
      });

    expect(timelineResponse.status).toBe(201);

    const listTimelineResponse = await ownerAgent.get(`/v1/incidents/${incidentId}/timeline-events`);
    expect(listTimelineResponse.status).toBe(200);
    const timeline = listTimelineResponse.body as TimelineListResponse;
    expect(Array.isArray(timeline.events)).toBe(true);
    expect(timeline.events.length).toBe(1);

    const createTaskResponse = await ownerAgent
      .post(`/v1/incidents/${incidentId}/tasks`)
      .set('x-csrf-token', timeline.csrfToken)
      .send({
        title: 'Rollback release',
        description: 'Rollback canary to previous stable version'
      });

    expect(createTaskResponse.status).toBe(201);
    const taskCreated = createTaskResponse.body as TaskResponse;

    const updateTaskResponse = await ownerAgent
      .patch(`/v1/incidents/${incidentId}/tasks/${taskCreated.task.id}`)
      .set('x-csrf-token', taskCreated.csrfToken)
      .send({ status: 'in_progress' });

    expect(updateTaskResponse.status).toBe(200);
    expect((updateTaskResponse.body as TaskResponse).task.status).toBe('in_progress');

    const statusUpdateResponse = await ownerAgent
      .post(`/v1/incidents/${incidentId}/status-updates`)
      .set('x-csrf-token', (updateTaskResponse.body as TaskResponse).csrfToken)
      .send({
        audience: 'internal',
        message: 'Mitigation in progress',
        publishedAt: new Date().toISOString()
      });

    expect(statusUpdateResponse.status).toBe(201);

    const listStatusUpdatesResponse = await ownerAgent.get(`/v1/incidents/${incidentId}/status-updates`);
    expect(listStatusUpdatesResponse.status).toBe(200);
    const statusUpdates = listStatusUpdatesResponse.body as StatusUpdatesListResponse;
    expect(Array.isArray(statusUpdates.updates)).toBe(true);
    expect(statusUpdates.updates.length).toBe(1);
  });

  it('denies incident creation for viewer role but allows reads', async () => {
    await seedUser(runtime, 'owner@example.com', 'OwnerPassword123!');
    await seedUser(runtime, 'viewer@example.com', 'ViewerPassword123!');

    const ownerAgent = request.agent(runtime.app);
    const viewerAgent = request.agent(runtime.app);

    const ownerLoginToken = await login(ownerAgent, 'owner@example.com', 'OwnerPassword123!');

    const tenantCreateResponse = await ownerAgent
      .post('/v1/tenants')
      .set('x-csrf-token', ownerLoginToken)
      .send({ name: 'Shared Tenant' });

    expect(tenantCreateResponse.status).toBe(201);
    const tenant = tenantCreateResponse.body as TenantCreateResponse;

    const incidentCreateResponse = await ownerAgent
      .post('/v1/incidents')
      .set('x-csrf-token', tenant.csrfToken)
      .send({
        title: 'Networking issue',
        description: 'Packet loss spike',
        severity: 'SEV3',
        startTime: new Date().toISOString(),
        impactedServices: ['edge-proxy']
      });

    expect(incidentCreateResponse.status).toBe(201);

    const inviteResponse = await ownerAgent
      .post(`/v1/tenants/${tenant.tenant.id}/invites`)
      .set('x-csrf-token', (incidentCreateResponse.body as IncidentResponse).csrfToken)
      .send({
        email: 'viewer@example.com',
        role: 'Viewer'
      });

    expect(inviteResponse.status).toBe(201);
    const invite = inviteResponse.body as InviteResponse;
    expect(typeof invite.inviteToken).toBe('string');

    if (typeof invite.inviteToken !== 'string') {
      throw new Error('Expected invite token in test mode.');
    }

    const viewerLoginToken = await login(viewerAgent, 'viewer@example.com', 'ViewerPassword123!');

    const acceptInviteResponse = await viewerAgent
      .post('/v1/tenants/invites/accept')
      .set('x-csrf-token', viewerLoginToken)
      .send({ token: invite.inviteToken });

    expect(acceptInviteResponse.status).toBe(200);

    const deniedCreateResponse = await viewerAgent
      .post('/v1/incidents')
      .set('x-csrf-token', (acceptInviteResponse.body as InviteAcceptResponse).csrfToken)
      .send({
        title: 'Viewer created incident',
        description: '',
        severity: 'SEV4',
        startTime: new Date().toISOString(),
        impactedServices: []
      });

    expect(deniedCreateResponse.status).toBe(403);
    expect((deniedCreateResponse.body as ErrorResponse).code).toBe('PERMISSION_DENIED');

    const listResponse = await viewerAgent.get('/v1/incidents');
    expect(listResponse.status).toBe(200);
    const listedIncidents = listResponse.body as IncidentListResponse;
    expect(Array.isArray(listedIncidents.incidents)).toBe(true);
    expect(listedIncidents.incidents.length).toBe(1);
  });

  it('requires an active tenant context for incident endpoints', async () => {
    await seedUser(runtime, 'owner@example.com', 'OwnerPassword123!');

    const agent = request.agent(runtime.app);
    const loginCsrf = await login(agent, 'owner@example.com', 'OwnerPassword123!');

    const listResponse = await agent.get('/v1/incidents');
    expect(listResponse.status).toBe(400);
    expect((listResponse.body as ErrorResponse).code).toBe('TENANT_CONTEXT_REQUIRED');

    const createResponse = await agent
      .post('/v1/incidents')
      .set('x-csrf-token', loginCsrf)
      .send({
        title: 'No tenant context',
        description: '',
        severity: 'SEV4',
        startTime: new Date().toISOString(),
        impactedServices: []
      });

    expect(createResponse.status).toBe(400);
    expect((createResponse.body as ErrorResponse).code).toBe('TENANT_CONTEXT_REQUIRED');
  });

  it('returns 404 for cross-tenant ID-based access attempts', async () => {
    await seedUser(runtime, 'owner@example.com', 'OwnerPassword123!');

    const ownerAgent = request.agent(runtime.app);
    const loginCsrf = await login(ownerAgent, 'owner@example.com', 'OwnerPassword123!');

    const tenantOneResponse = await ownerAgent
      .post('/v1/tenants')
      .set('x-csrf-token', loginCsrf)
      .send({ name: 'Primary Tenant' });

    expect(tenantOneResponse.status).toBe(201);
    const tenantOne = tenantOneResponse.body as TenantCreateResponse;

    const incidentResponse = await ownerAgent
      .post('/v1/incidents')
      .set('x-csrf-token', tenantOne.csrfToken)
      .send({
        title: 'Tenant-one incident',
        description: 'Scoped to tenant one',
        severity: 'SEV2',
        startTime: new Date().toISOString(),
        impactedServices: ['api']
      });

    expect(incidentResponse.status).toBe(201);
    const incident = incidentResponse.body as IncidentResponse;
    const incidentId = incident.incident.id;

    const timelineCreateResponse = await ownerAgent
      .post(`/v1/incidents/${incidentId}/timeline-events`)
      .set('x-csrf-token', incident.csrfToken)
      .send({
        eventTime: new Date().toISOString(),
        eventType: 'investigation',
        message: 'Collected logs'
      });

    expect(timelineCreateResponse.status).toBe(201);

    const taskCreateResponse = await ownerAgent
      .post(`/v1/incidents/${incidentId}/tasks`)
      .set('x-csrf-token', (timelineCreateResponse.body as { csrfToken: string }).csrfToken)
      .send({
        title: 'Scale workers',
        description: 'Increase worker capacity'
      });

    expect(taskCreateResponse.status).toBe(201);
    const taskId = (taskCreateResponse.body as TaskResponse).task.id;

    const statusUpdateResponse = await ownerAgent
      .post(`/v1/incidents/${incidentId}/status-updates`)
      .set('x-csrf-token', (taskCreateResponse.body as TaskResponse).csrfToken)
      .send({
        audience: 'internal',
        message: 'Mitigation in progress',
        publishedAt: new Date().toISOString()
      });

    expect(statusUpdateResponse.status).toBe(201);

    const tenantTwoResponse = await ownerAgent
      .post('/v1/tenants')
      .set('x-csrf-token', (statusUpdateResponse.body as { csrfToken: string }).csrfToken)
      .send({ name: 'Secondary Tenant' });

    expect(tenantTwoResponse.status).toBe(201);
    const activeTenantTwoCsrf = (tenantTwoResponse.body as TenantCreateResponse).csrfToken;

    const listInTenantTwoResponse = await ownerAgent.get('/v1/incidents');
    expect(listInTenantTwoResponse.status).toBe(200);
    expect((listInTenantTwoResponse.body as IncidentListResponse).incidents.length).toBe(0);

    const getIncidentResponse = await ownerAgent.get(`/v1/incidents/${incidentId}`);
    expect(getIncidentResponse.status).toBe(404);
    expect((getIncidentResponse.body as ErrorResponse).code).toBe('INCIDENT_NOT_FOUND');

    const patchIncidentResponse = await ownerAgent
      .patch(`/v1/incidents/${incidentId}`)
      .set('x-csrf-token', activeTenantTwoCsrf)
      .send({ status: 'investigating' });

    expect(patchIncidentResponse.status).toBe(404);
    expect((patchIncidentResponse.body as ErrorResponse).code).toBe('INCIDENT_NOT_FOUND');

    const listTimelineResponse = await ownerAgent.get(`/v1/incidents/${incidentId}/timeline-events`);
    expect(listTimelineResponse.status).toBe(404);
    expect((listTimelineResponse.body as ErrorResponse).code).toBe('INCIDENT_NOT_FOUND');

    const createTimelineResponse = await ownerAgent
      .post(`/v1/incidents/${incidentId}/timeline-events`)
      .set('x-csrf-token', activeTenantTwoCsrf)
      .send({
        eventTime: new Date().toISOString(),
        eventType: 'monitoring',
        message: 'Should be denied cross-tenant'
      });

    expect(createTimelineResponse.status).toBe(404);
    expect((createTimelineResponse.body as ErrorResponse).code).toBe('INCIDENT_NOT_FOUND');

    const listTasksResponse = await ownerAgent.get(`/v1/incidents/${incidentId}/tasks`);
    expect(listTasksResponse.status).toBe(404);
    expect((listTasksResponse.body as ErrorResponse).code).toBe('INCIDENT_NOT_FOUND');

    const createTaskResponse = await ownerAgent
      .post(`/v1/incidents/${incidentId}/tasks`)
      .set('x-csrf-token', activeTenantTwoCsrf)
      .send({
        title: 'Should fail',
        description: 'Cross tenant'
      });

    expect(createTaskResponse.status).toBe(404);
    expect((createTaskResponse.body as ErrorResponse).code).toBe('INCIDENT_NOT_FOUND');

    const patchTaskResponse = await ownerAgent
      .patch(`/v1/incidents/${incidentId}/tasks/${taskId}`)
      .set('x-csrf-token', activeTenantTwoCsrf)
      .send({ status: 'completed' });

    expect(patchTaskResponse.status).toBe(404);
    expect((patchTaskResponse.body as ErrorResponse).code).toBe('INCIDENT_NOT_FOUND');

    const listStatusUpdateResponse = await ownerAgent.get(`/v1/incidents/${incidentId}/status-updates`);
    expect(listStatusUpdateResponse.status).toBe(404);
    expect((listStatusUpdateResponse.body as ErrorResponse).code).toBe('INCIDENT_NOT_FOUND');

    const createStatusUpdateResponse = await ownerAgent
      .post(`/v1/incidents/${incidentId}/status-updates`)
      .set('x-csrf-token', activeTenantTwoCsrf)
      .send({
        audience: 'internal',
        message: 'Should fail',
        publishedAt: new Date().toISOString()
      });

    expect(createStatusUpdateResponse.status).toBe(404);
    expect((createStatusUpdateResponse.body as ErrorResponse).code).toBe('INCIDENT_NOT_FOUND');
  });

  it('returns 403 only when object existence is established for denied users', async () => {
    await seedUser(runtime, 'owner@example.com', 'OwnerPassword123!');
    await seedUser(runtime, 'billing@example.com', 'BillingPassword123!');

    const ownerAgent = request.agent(runtime.app);
    const billingAgent = request.agent(runtime.app);

    const ownerLoginCsrf = await login(ownerAgent, 'owner@example.com', 'OwnerPassword123!');

    const tenantResponse = await ownerAgent
      .post('/v1/tenants')
      .set('x-csrf-token', ownerLoginCsrf)
      .send({ name: 'Finance Tenant' });

    expect(tenantResponse.status).toBe(201);
    const tenant = tenantResponse.body as TenantCreateResponse;

    const incidentResponse = await ownerAgent
      .post('/v1/incidents')
      .set('x-csrf-token', tenant.csrfToken)
      .send({
        title: 'Billing cannot read this',
        description: 'Restricted incident',
        severity: 'SEV3',
        startTime: new Date().toISOString(),
        impactedServices: ['billing']
      });

    expect(incidentResponse.status).toBe(201);
    const incident = incidentResponse.body as IncidentResponse;

    const createTaskResponse = await ownerAgent
      .post(`/v1/incidents/${incident.incident.id}/tasks`)
      .set('x-csrf-token', incident.csrfToken)
      .send({
        title: 'Verify invoices',
        description: 'Confirm invoice queue'
      });

    expect(createTaskResponse.status).toBe(201);
    const task = createTaskResponse.body as TaskResponse;

    const inviteResponse = await ownerAgent
      .post(`/v1/tenants/${tenant.tenant.id}/invites`)
      .set('x-csrf-token', task.csrfToken)
      .send({
        email: 'billing@example.com',
        role: 'Billing'
      });

    expect(inviteResponse.status).toBe(201);
    const invite = inviteResponse.body as InviteResponse;
    expect(typeof invite.inviteToken).toBe('string');
    if (typeof invite.inviteToken !== 'string') {
      throw new Error('Expected invite token for billing user.');
    }

    const billingLoginCsrf = await login(billingAgent, 'billing@example.com', 'BillingPassword123!');
    const acceptInviteResponse = await billingAgent
      .post('/v1/tenants/invites/accept')
      .set('x-csrf-token', billingLoginCsrf)
      .send({ token: invite.inviteToken });

    expect(acceptInviteResponse.status).toBe(200);
    const billingCsrf = (acceptInviteResponse.body as InviteAcceptResponse).csrfToken;

    const deniedReadResponse = await billingAgent.get(`/v1/incidents/${incident.incident.id}`);
    expect(deniedReadResponse.status).toBe(403);
    expect((deniedReadResponse.body as ErrorResponse).code).toBe('PERMISSION_DENIED');

    const missingReadResponse = await billingAgent.get(`/v1/incidents/${randomUUID()}`);
    expect(missingReadResponse.status).toBe(404);
    expect((missingReadResponse.body as ErrorResponse).code).toBe('INCIDENT_NOT_FOUND');

    const deniedTaskUpdateResponse = await billingAgent
      .patch(`/v1/incidents/${incident.incident.id}/tasks/${task.task.id}`)
      .set('x-csrf-token', billingCsrf)
      .send({ status: 'completed' });

    expect(deniedTaskUpdateResponse.status).toBe(403);
    expect((deniedTaskUpdateResponse.body as ErrorResponse).code).toBe('PERMISSION_DENIED');

    const missingTaskUpdateResponse = await billingAgent
      .patch(`/v1/incidents/${incident.incident.id}/tasks/${randomUUID()}`)
      .set('x-csrf-token', billingCsrf)
      .send({ status: 'completed' });

    expect(missingTaskUpdateResponse.status).toBe(404);
    expect((missingTaskUpdateResponse.body as ErrorResponse).code).toBe('TASK_NOT_FOUND');
  });
});
