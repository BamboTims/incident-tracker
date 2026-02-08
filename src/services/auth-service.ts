import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';

import { AppError } from '../errors/app-error.js';
import type { AuthRepository, AuthUser } from '../repositories/auth-repository.js';

export interface AuthServiceConfig {
  lockoutAttempts: number;
  lockoutSeconds: number;
  resetTokenTtlMinutes: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  passwordUpdatedAt: Date;
  createdAt: Date;
}

function toPublicUser(user: AuthUser): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    passwordUpdatedAt: user.passwordUpdatedAt,
    createdAt: user.createdAt
  };
}

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class AuthService {
  public constructor(
    private readonly repository: AuthRepository,
    private readonly config: AuthServiceConfig
  ) {}

  public async createUser(email: string, password: string): Promise<AuthenticatedUser> {
    this.validatePasswordStrength(password);

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1
    });

    const user = await this.repository.createUser({
      email,
      passwordHash
    });

    return toPublicUser(user);
  }

  public async getCurrentUser(userId: string): Promise<AuthenticatedUser | null> {
    const user = await this.repository.findUserById(userId);
    return user === null ? null : toPublicUser(user);
  }

  public async login(email: string, password: string, now: Date): Promise<AuthenticatedUser> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.repository.findUserByEmail(normalizedEmail);
    if (user === null) {
      throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    if (user.lockoutUntil !== null && user.lockoutUntil.getTime() > now.getTime()) {
      throw new AppError(423, 'AUTH_ACCOUNT_LOCKED', 'Account is temporarily locked.', {
        retryAt: user.lockoutUntil.toISOString()
      });
    }

    const validPassword = await argon2.verify(user.passwordHash, password);
    if (!validPassword) {
      const failedLoginAttempts = user.failedLoginAttempts + 1;
      let lockoutUntil: Date | null = null;

      if (failedLoginAttempts >= this.config.lockoutAttempts) {
        lockoutUntil = new Date(now.getTime() + this.config.lockoutSeconds * 1_000);
      }

      await this.repository.recordFailedLogin(user.id, failedLoginAttempts, lockoutUntil);

      if (lockoutUntil !== null) {
        throw new AppError(423, 'AUTH_ACCOUNT_LOCKED', 'Account is temporarily locked.', {
          retryAt: lockoutUntil.toISOString()
        });
      }

      throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    await this.repository.clearFailedLoginState(user.id);
    return toPublicUser(user);
  }

  public async requestPasswordReset(email: string): Promise<string | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.repository.findUserByEmail(normalizedEmail);
    await this.repository.purgeExpiredPasswordResetTokens(new Date());

    if (user === null) {
      return null;
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashResetToken(token);
    const expiresAt = new Date(Date.now() + this.config.resetTokenTtlMinutes * 60_000);
    await this.repository.createPasswordResetToken(user.id, tokenHash, expiresAt);

    return token;
  }

  public async resetPassword(token: string, newPassword: string): Promise<void> {
    this.validatePasswordStrength(newPassword);

    const tokenHash = hashResetToken(token);
    const now = new Date();
    const user = await this.repository.consumePasswordResetToken(tokenHash, now);

    if (user === null) {
      throw new AppError(400, 'AUTH_RESET_TOKEN_INVALID', 'Password reset token is invalid or expired.');
    }

    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1
    });

    await this.repository.updateUserPassword(user.id, passwordHash, now);
    await this.repository.clearFailedLoginState(user.id);
  }

  private validatePasswordStrength(password: string): void {
    if (password.length < 12) {
      throw new AppError(400, 'AUTH_PASSWORD_WEAK', 'Password must be at least 12 characters long.');
    }
  }
}