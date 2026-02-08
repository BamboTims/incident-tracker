import { randomUUID } from 'node:crypto';

import type { AuthRepository, AuthUser, CreateUserInput, PasswordResetToken } from './auth-repository.js';

function cloneUser(user: AuthUser): AuthUser {
  return {
    ...user,
    passwordUpdatedAt: new Date(user.passwordUpdatedAt),
    lockoutUntil: user.lockoutUntil === null ? null : new Date(user.lockoutUntil),
    createdAt: new Date(user.createdAt),
    updatedAt: new Date(user.updatedAt)
  };
}

export class InMemoryAuthRepository implements AuthRepository {
  private readonly usersById = new Map<string, AuthUser>();

  private readonly userIdsByEmail = new Map<string, string>();

  private readonly passwordResetTokensByHash = new Map<string, PasswordResetToken>();

  public createUser(input: CreateUserInput): Promise<AuthUser> {
    const normalizedEmail = input.email.trim().toLowerCase();
    if (this.userIdsByEmail.has(normalizedEmail)) {
      throw new Error('Email already exists.');
    }

    const now = new Date();
    const user: AuthUser = {
      id: randomUUID(),
      email: normalizedEmail,
      passwordHash: input.passwordHash,
      passwordUpdatedAt: now,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      createdAt: now,
      updatedAt: now
    };

    this.usersById.set(user.id, user);
    this.userIdsByEmail.set(user.email, user.id);

    return Promise.resolve(cloneUser(user));
  }

  public findUserById(userId: string): Promise<AuthUser | null> {
    const user = this.usersById.get(userId);
    return Promise.resolve(user === undefined ? null : cloneUser(user));
  }

  public findUserByEmail(email: string): Promise<AuthUser | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const userId = this.userIdsByEmail.get(normalizedEmail);
    if (userId === undefined) {
      return Promise.resolve(null);
    }

    const user = this.usersById.get(userId);
    return Promise.resolve(user === undefined ? null : cloneUser(user));
  }

  public updateUserPassword(userId: string, passwordHash: string, passwordUpdatedAt: Date): Promise<void> {
    const user = this.usersById.get(userId);
    if (user === undefined) {
      return Promise.resolve();
    }

    user.passwordHash = passwordHash;
    user.passwordUpdatedAt = new Date(passwordUpdatedAt);
    user.updatedAt = new Date(passwordUpdatedAt);
    user.failedLoginAttempts = 0;
    user.lockoutUntil = null;

    this.usersById.set(user.id, user);
    return Promise.resolve();
  }

  public recordFailedLogin(userId: string, failedLoginAttempts: number, lockoutUntil: Date | null): Promise<void> {
    const user = this.usersById.get(userId);
    if (user === undefined) {
      return Promise.resolve();
    }

    user.failedLoginAttempts = failedLoginAttempts;
    user.lockoutUntil = lockoutUntil;
    user.updatedAt = new Date();

    this.usersById.set(user.id, user);
    return Promise.resolve();
  }

  public clearFailedLoginState(userId: string): Promise<void> {
    const user = this.usersById.get(userId);
    if (user === undefined) {
      return Promise.resolve();
    }

    user.failedLoginAttempts = 0;
    user.lockoutUntil = null;
    user.updatedAt = new Date();

    this.usersById.set(user.id, user);
    return Promise.resolve();
  }

  public createPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    const token: PasswordResetToken = {
      id: randomUUID(),
      userId,
      tokenHash,
      expiresAt,
      usedAt: null,
      createdAt: new Date()
    };

    this.passwordResetTokensByHash.set(tokenHash, token);
    return Promise.resolve();
  }

  public consumePasswordResetToken(tokenHash: string, now: Date): Promise<AuthUser | null> {
    const token = this.passwordResetTokensByHash.get(tokenHash);
    if (token === undefined) {
      return Promise.resolve(null);
    }

    if (token.usedAt !== null || token.expiresAt.getTime() < now.getTime()) {
      return Promise.resolve(null);
    }

    token.usedAt = new Date(now);
    this.passwordResetTokensByHash.set(tokenHash, token);

    const user = this.usersById.get(token.userId);
    return Promise.resolve(user === undefined ? null : cloneUser(user));
  }

  public purgeExpiredPasswordResetTokens(now: Date): Promise<void> {
    for (const [hash, token] of this.passwordResetTokensByHash.entries()) {
      if (token.expiresAt.getTime() < now.getTime()) {
        this.passwordResetTokensByHash.delete(hash);
      }
    }
    return Promise.resolve();
  }
}
