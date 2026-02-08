import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import type { AuthRepository, AuthUser, CreateUserInput } from './auth-repository.js';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  password_updated_at: Date;
  failed_login_attempts: number;
  lockout_until: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    passwordUpdatedAt: row.password_updated_at,
    failedLoginAttempts: row.failed_login_attempts,
    lockoutUntil: row.lockout_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getSingleRow(rows: UserRow[]): UserRow | null {
  const [row] = rows;
  return row ?? null;
}

export class PostgresAuthRepository implements AuthRepository {
  public constructor(private readonly pool: Pool) {}

  public async createUser(input: CreateUserInput): Promise<AuthUser> {
    const id = randomUUID();
    const normalizedEmail = input.email.trim().toLowerCase();
    const now = new Date();

    const result = await this.pool.query<UserRow>(
      `
      INSERT INTO users (
        id,
        email,
        password_hash,
        password_updated_at,
        failed_login_attempts,
        lockout_until,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, 0, NULL, $4, $4)
      RETURNING *
      `,
      [id, normalizedEmail, input.passwordHash, now]
    );

    const row = getSingleRow(result.rows);
    if (row === null) {
      throw new Error('Failed to create user row.');
    }

    return mapUser(row);
  }

  public async findUserById(userId: string): Promise<AuthUser | null> {
    const result = await this.pool.query<UserRow>(
      `
      SELECT *
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

    const row = getSingleRow(result.rows);
    return row === null ? null : mapUser(row);
  }

  public async findUserByEmail(email: string): Promise<AuthUser | null> {
    const normalizedEmail = email.trim().toLowerCase();

    const result = await this.pool.query<UserRow>(
      `
      SELECT *
      FROM users
      WHERE email = $1
      LIMIT 1
      `,
      [normalizedEmail]
    );

    const row = getSingleRow(result.rows);
    return row === null ? null : mapUser(row);
  }

  public async updateUserPassword(userId: string, passwordHash: string, passwordUpdatedAt: Date): Promise<void> {
    await this.pool.query(
      `
      UPDATE users
      SET password_hash = $2,
          password_updated_at = $3,
          failed_login_attempts = 0,
          lockout_until = NULL,
          updated_at = $3
      WHERE id = $1
      `,
      [userId, passwordHash, passwordUpdatedAt]
    );
  }

  public async recordFailedLogin(userId: string, failedLoginAttempts: number, lockoutUntil: Date | null): Promise<void> {
    await this.pool.query(
      `
      UPDATE users
      SET failed_login_attempts = $2,
          lockout_until = $3,
          updated_at = NOW()
      WHERE id = $1
      `,
      [userId, failedLoginAttempts, lockoutUntil]
    );
  }

  public async clearFailedLoginState(userId: string): Promise<void> {
    await this.pool.query(
      `
      UPDATE users
      SET failed_login_attempts = 0,
          lockout_until = NULL,
          updated_at = NOW()
      WHERE id = $1
      `,
      [userId]
    );
  }

  public async createPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
      VALUES ($1, $2, $3, $4, NULL, NOW())
      `,
      [randomUUID(), userId, tokenHash, expiresAt]
    );
  }

  public async consumePasswordResetToken(tokenHash: string, now: Date): Promise<AuthUser | null> {
    const result = await this.pool.query<UserRow>(
      `
      WITH consumed_token AS (
        UPDATE password_reset_tokens
        SET used_at = $2
        WHERE token_hash = $1
          AND used_at IS NULL
          AND expires_at >= $2
        RETURNING user_id
      )
      SELECT u.*
      FROM users u
      INNER JOIN consumed_token c
        ON u.id = c.user_id
      LIMIT 1
      `,
      [tokenHash, now]
    );

    const row = getSingleRow(result.rows);
    return row === null ? null : mapUser(row);
  }

  public async purgeExpiredPasswordResetTokens(now: Date): Promise<void> {
    await this.pool.query(
      `
      DELETE FROM password_reset_tokens
      WHERE expires_at < $1
      `,
      [now]
    );
  }
}
