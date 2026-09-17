import { UnauthenticatedError } from '@/server/http/errors';

// Deliberately identical for a missing user and a wrong password — the login
// response must not let a caller distinguish "no such account" from "wrong
// password" (security-and-audit.md).
export class InvalidCredentialsError extends UnauthenticatedError {
  constructor() {
    super('Invalid email or password');
  }
}
