import argon2 from 'argon2';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppRuntime } from '../../src/app.js';
import { createTestRuntime } from '../helpers/create-test-runtime.js';

interface AuthStateResponse {
  authenticated: boolean;
  csrfToken: string;
  user?: {
    id: string;
    email: string;
  };
}

interface ErrorResponse {
  code: string;
}

interface ForgotPasswordResponse {
  code: string;
  message: string;
  resetToken?: string;
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

describe('auth integration', () => {
  let runtime: AppRuntime;
  let agent: request.Agent;

  beforeEach(async () => {
    runtime = await createTestRuntime();
    agent = request.agent(runtime.app);
  });

  afterEach(async () => {
    await runtime.close();
  });

  it('creates a session on successful login and exposes current user', async () => {
    await seedUser(runtime, 'alice@example.com', 'ValidPassword123!');
    const csrfToken = await getCsrfToken(agent);

    const loginResponse = await agent
      .post('/v1/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({
        email: 'alice@example.com',
        password: 'ValidPassword123!'
      });

    expect(loginResponse.status).toBe(200);
    expect((loginResponse.body as AuthStateResponse).authenticated).toBe(true);
    expect((loginResponse.body as AuthStateResponse).user?.email).toBe('alice@example.com');

    const meResponse = await agent.get('/v1/auth/me');
    expect(meResponse.status).toBe(200);
    expect((meResponse.body as AuthStateResponse).authenticated).toBe(true);
    expect((meResponse.body as AuthStateResponse).user?.email).toBe('alice@example.com');
  });

  it('signs up a new user and establishes a session', async () => {
    const csrfToken = await getCsrfToken(agent);

    const signupResponse = await agent
      .post('/v1/auth/signup')
      .set('x-csrf-token', csrfToken)
      .send({
        email: 'signup@example.com',
        password: 'SignupPassword123!'
      });

    expect(signupResponse.status).toBe(201);
    expect((signupResponse.body as AuthStateResponse).authenticated).toBe(true);
    expect((signupResponse.body as AuthStateResponse).user?.email).toBe('signup@example.com');

    const meResponse = await agent.get('/v1/auth/me');
    expect(meResponse.status).toBe(200);
    expect((meResponse.body as AuthStateResponse).authenticated).toBe(true);
    expect((meResponse.body as AuthStateResponse).user?.email).toBe('signup@example.com');
  });

  it('rejects signup when email is already used', async () => {
    await seedUser(runtime, 'taken@example.com', 'TakenPassword123!');
    const csrfToken = await getCsrfToken(agent);

    const response = await agent
      .post('/v1/auth/signup')
      .set('x-csrf-token', csrfToken)
      .send({
        email: 'taken@example.com',
        password: 'AnotherPassword123!'
      });

    expect(response.status).toBe(409);
    expect((response.body as ErrorResponse).code).toBe('AUTH_EMAIL_IN_USE');
  });

  it('invalidates session on logout', async () => {
    await seedUser(runtime, 'bob@example.com', 'ValidPassword123!');
    const csrfToken = await getCsrfToken(agent);

    const loginResponse = await agent
      .post('/v1/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({
        email: 'bob@example.com',
        password: 'ValidPassword123!'
      });

    expect(loginResponse.status).toBe(200);
    const logoutToken = (loginResponse.body as AuthStateResponse).csrfToken;

    const logoutResponse = await agent
      .post('/v1/auth/logout')
      .set('x-csrf-token', logoutToken)
      .send({});

    expect(logoutResponse.status).toBe(204);

    const meResponse = await agent.get('/v1/auth/me');
    expect(meResponse.status).toBe(200);
    expect((meResponse.body as AuthStateResponse).authenticated).toBe(false);
  });

  it('locks account after repeated invalid password attempts', async () => {
    await seedUser(runtime, 'locked@example.com', 'ValidPassword123!');
    const csrfToken = await getCsrfToken(agent);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await agent
        .post('/v1/auth/login')
        .set('x-csrf-token', csrfToken)
        .send({
          email: 'locked@example.com',
          password: 'WrongPassword123!'
        });

      expect(response.status).toBe(401);
      expect((response.body as ErrorResponse).code).toBe('AUTH_INVALID_CREDENTIALS');
    }

    const lockResponse = await agent
      .post('/v1/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({
        email: 'locked@example.com',
        password: 'WrongPassword123!'
      });

    expect(lockResponse.status).toBe(423);
    expect((lockResponse.body as ErrorResponse).code).toBe('AUTH_ACCOUNT_LOCKED');

    const deniedResponse = await agent
      .post('/v1/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({
        email: 'locked@example.com',
        password: 'ValidPassword123!'
      });

    expect(deniedResponse.status).toBe(423);
    expect((deniedResponse.body as ErrorResponse).code).toBe('AUTH_ACCOUNT_LOCKED');
  });

  it('rejects mutating requests without CSRF token', async () => {
    await seedUser(runtime, 'csrf@example.com', 'ValidPassword123!');

    const response = await agent.post('/v1/auth/login').send({
      email: 'csrf@example.com',
      password: 'ValidPassword123!'
    });

    expect(response.status).toBe(403);
    expect((response.body as ErrorResponse).code).toBe('CSRF_TOKEN_INVALID');
  });

  it('sets secure session cookie behind trusted proxy in production', async () => {
    await runtime.close();
    runtime = await createTestRuntime({
      envOverrides: {
        NODE_ENV: 'production',
        SESSION_COOKIE_SECURE: true
      }
    });

    const response = await request(runtime.app)
      .get('/v1/auth/me')
      .set('x-forwarded-proto', 'https');

    expect(response.status).toBe(200);
    const setCookieHeader = response.headers['set-cookie'];
    const cookies = Array.isArray(setCookieHeader)
      ? setCookieHeader
      : typeof setCookieHeader === 'string'
        ? [setCookieHeader]
        : [];

    expect(cookies.length).toBeGreaterThan(0);
    const cookieText = cookies.join(';');
    expect(cookieText).toContain('incident_tracker_sid=');
    expect(cookieText).toContain('Secure');
  });

  it('resets password with a valid token and rejects invalid tokens', async () => {
    await seedUser(runtime, 'reset@example.com', 'ValidPassword123!');
    const csrfToken = await getCsrfToken(agent);

    const forgotResponse = await agent
      .post('/v1/auth/password/forgot')
      .set('x-csrf-token', csrfToken)
      .send({
        email: 'reset@example.com'
      });

    expect(forgotResponse.status).toBe(202);
    expect(typeof (forgotResponse.body as ForgotPasswordResponse).resetToken).toBe('string');

    const invalidResetResponse = await agent
      .post('/v1/auth/password/reset')
      .set('x-csrf-token', csrfToken)
      .send({
        token: 'invalid-token-value-12345',
        newPassword: 'NewValidPassword123!'
      });

    expect(invalidResetResponse.status).toBe(400);
    expect((invalidResetResponse.body as ErrorResponse).code).toBe('AUTH_RESET_TOKEN_INVALID');

    const forgotBody = forgotResponse.body as ForgotPasswordResponse;
    expect(typeof forgotBody.resetToken).toBe('string');
    if (typeof forgotBody.resetToken !== 'string') {
      throw new Error('resetToken should be present in test mode');
    }

    const validResetResponse = await agent
      .post('/v1/auth/password/reset')
      .set('x-csrf-token', csrfToken)
      .send({
        token: forgotBody.resetToken,
        newPassword: 'NewValidPassword123!'
      });

    expect(validResetResponse.status).toBe(204);

    const oldPasswordLogin = await agent
      .post('/v1/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({
        email: 'reset@example.com',
        password: 'ValidPassword123!'
      });

    expect(oldPasswordLogin.status).toBe(401);

    const newPasswordLogin = await agent
      .post('/v1/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({
        email: 'reset@example.com',
        password: 'NewValidPassword123!'
      });

    expect(newPasswordLogin.status).toBe(200);
    expect((newPasswordLogin.body as AuthStateResponse).authenticated).toBe(true);
  });
});
