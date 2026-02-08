import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    activeTenantId?: string;
    csrfToken?: string;
  }
}

export {};