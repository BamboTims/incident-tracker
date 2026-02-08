export interface AuthUser {
  id: string;
  email: string;
  passwordHash: string;
  passwordUpdatedAt: Date;
  failedLoginAttempts: number;
  lockoutUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PasswordResetToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
}

export interface AuthRepository {
  createUser(input: CreateUserInput): Promise<AuthUser>;
  findUserById(userId: string): Promise<AuthUser | null>;
  findUserByEmail(email: string): Promise<AuthUser | null>;
  updateUserPassword(userId: string, passwordHash: string, passwordUpdatedAt: Date): Promise<void>;
  recordFailedLogin(userId: string, failedLoginAttempts: number, lockoutUntil: Date | null): Promise<void>;
  clearFailedLoginState(userId: string): Promise<void>;
  createPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  consumePasswordResetToken(tokenHash: string, now: Date): Promise<AuthUser | null>;
  purgeExpiredPasswordResetTokens(now: Date): Promise<void>;
}