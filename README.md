# Incident Tracker

Production-minded multi-tenant incident tracker backend scaffold with:

- TypeScript (`strict: true`) + ESLint
- Express 5 API
- Session-cookie auth + CSRF protection
- Argon2id password hashing
- Login lockout and password reset token flow
- Redis-backed session store (memory store in tests)
- PostgreSQL repositories for auth, tenancy, incidents, audit logs, API keys, and usage
- Tenant, membership, and invitation workflows
- PostgreSQL RLS policies for tenant-scoped membership and invite tables
- Centralized RBAC policy engine (`authorize(action, resource, ctx)`)
- Append-only audit logging for sensitive auth/tenant/incident mutations
- Service accounts + scoped API keys (`read` / `write`)
- Usage metering and daily write quota enforcement
- OpenTelemetry hooks for HTTP/DB traces and metrics
- OpenAPI 3.1 contract in `openapi.yaml`
- Integration tests for auth/session, tenancy, incidents, API keys, and quota

## Primary auth model

- Primary auth is cookie-based sessions + CSRF.
- OIDC/PKCE is not in MVP scope.
- Login is email/password only.

## Quick start

1. Install dependencies:

```bash
pnpm install
```

2. Start dependencies:

```bash
docker compose up -d redis postgres mailpit
```

3. Create `.env` from `.env.example` and set `SESSION_SECRET`.

4. Run the API:

```bash
pnpm dev
```

## Scripts

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:integration:postgres`
- `pnpm db:migrate`
- `pnpm openapi:validate`

## Authorization semantics

- ID-based endpoints are leak-resistant by default:
  - `404` when an object is missing or inaccessible in active tenant context
  - `403` only when object existence is established and permission is denied

## Auth endpoints

- `GET /v1/auth/me`
- `POST /v1/auth/signup`
- `POST /v1/auth/login`
- `POST /v1/auth/logout`
- `POST /v1/auth/password/forgot`
- `POST /v1/auth/password/reset`

Use `GET /v1/auth/me` first to establish a session and get `csrfToken`.
Send `x-csrf-token` for all state-changing endpoints.
For API-key-authenticated automation requests, send `x-api-key` and skip CSRF.

## Tenancy endpoints

- `GET /v1/tenants`
- `POST /v1/tenants`
- `POST /v1/tenants/:tenantId/switch`
- `POST /v1/tenants/:tenantId/invites`
- `POST /v1/tenants/invites/accept`

## Incident endpoints

- `GET /v1/incidents`
- `POST /v1/incidents`
- `GET /v1/incidents/:incidentId`
- `PATCH /v1/incidents/:incidentId`
- `GET /v1/incidents/:incidentId/timeline-events`
- `POST /v1/incidents/:incidentId/timeline-events`
- `GET /v1/incidents/:incidentId/tasks`
- `POST /v1/incidents/:incidentId/tasks`
- `PATCH /v1/incidents/:incidentId/tasks/:taskId`
- `GET /v1/incidents/:incidentId/status-updates`
- `POST /v1/incidents/:incidentId/status-updates`

Incident routes accept either:

- Session cookie auth (CSRF required on mutating requests)
- API key auth via `x-api-key` (scope-checked; CSRF not required)

## API key management endpoints

- `GET /v1/tenants/:tenantId/service-accounts`
- `POST /v1/tenants/:tenantId/service-accounts`
- `GET /v1/tenants/:tenantId/api-keys`
- `POST /v1/tenants/:tenantId/api-keys`
- `POST /v1/tenants/:tenantId/api-keys/:apiKeyId/revoke`

These management endpoints require session auth and `api_keys.manage`.

## Platform endpoints

- `GET /v1/audit-logs` (requires `audit_log.read`)
- `GET /v1/usage` (requires `billing.read`)

## Security notes

- Session cookies are `httpOnly` and `sameSite=lax`.
- `secure` cookies are enabled in production.
- Passwords are hashed with Argon2id.
- Login attempts are lockout-protected.
- Sensitive actions write audit log entries (`audit_log_events` in Postgres).
- Write-heavy incident mutations are quota-protected and return `429 QUOTA_EXCEEDED` when over limit.
- Error format is consistent:

```json
{
  "code": "AUTH_INVALID_CREDENTIALS",
  "message": "Invalid email or password.",
  "traceId": "...",
  "details": {}
}
```

## CI

- GitHub Actions workflow (`.github/workflows/ci.yml`) runs:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm openapi:validate`
  - Postgres service + `pnpm db:migrate` + `pnpm test:integration:postgres`

## Deploy to Render

This repo includes `render.yaml` for Blueprint deploys.

1. Push this repo to GitHub.
2. In Render, choose `New` -> `Blueprint` and select the repo.
3. Confirm the `incident-tracker-api` web service from `render.yaml`.
4. Set `DATABASE_URL` and `REDIS_URL` in Render (both are marked `sync: false`).
5. Deploy.

Notes:

- Build command compiles TypeScript.
- `preDeployCommand` runs `pnpm db:migrate` before each deploy.
- Health check uses `GET /health`.
