export const API_KEY_SCOPES = ['read', 'write'] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export interface RequestAuthContext {
  authType: 'session' | 'api_key';
  userId: string;
  tenantId: string | null;
  apiKeyId: string | null;
  scopes: readonly ApiKeyScope[] | null;
}

export function hasWriteScope(context: RequestAuthContext): boolean {
  if (context.authType !== 'api_key') {
    return true;
  }

  return context.scopes?.includes('write') ?? false;
}

export function hasReadScope(context: RequestAuthContext): boolean {
  if (context.authType !== 'api_key') {
    return true;
  }

  return context.scopes?.includes('read') ?? false;
}
