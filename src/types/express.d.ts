import type { RequestAuthContext } from '../auth/auth-context.js';

declare global {
  namespace Express {
    interface Request {
      authContext?: RequestAuthContext;
    }
  }
}
