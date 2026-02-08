# Incident Tracker

Production-minded multi-tenant incident tracker backend scaffold with:

- TypeScript (`strict: true`) + ESLint
- Express 5 API
- Session-cookie auth + CSRF protection
- Argon2id password hashing
- Login lockout and password reset token flow
- Redis-backed session store (memory store in tests)
- PostgreSQL auth repository when `DATABASE_URL` is set (in-memory fallback otherwise)
- Tenant, membership, and invitation workflows
- PostgreSQL RLS policies for tenant-scoped membership and invite tables
- Centralized RBAC policy engine (`authorize(action, resource, ctx)`)
- OpenAPI 3.1 contract in `openapi.yaml`
- Integration tests for auth/session and tenancy flows

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
- `pnpm openapi:validate`

## Auth endpoints

- `GET /v1/auth/me`
- `POST /v1/auth/login`
- `POST /v1/auth/logout`
- `POST /v1/auth/password/forgot`
- `POST /v1/auth/password/reset`

Use `GET /v1/auth/me` first to establish a session and get `csrfToken`.
Send `x-csrf-token` for all state-changing endpoints.

## Tenancy endpoints

- `GET /v1/tenants`
- `POST /v1/tenants`
- `POST /v1/tenants/:tenantId/switch`
- `POST /v1/tenants/:tenantId/invites`
- `POST /v1/tenants/invites/accept`

## Security notes

- Session cookies are `httpOnly` and `sameSite=lax`.
- `secure` cookies are enabled in production.
- Passwords are hashed with Argon2id.
- Login attempts are lockout-protected.
- Error format is consistent:

```json
{
  "code": "AUTH_INVALID_CREDENTIALS",
  "message": "Invalid email or password.",
  "traceId": "...",
  "details": {}
}
```

## Docs

- `TENANCY.md`
- `PERMISSIONS.md`
- `openapi.yaml`
- `Agent.md`
- `requirements.md`
