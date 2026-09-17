import { verify } from 'argon2';

import { createSessionToken } from '@/server/auth/session';

import { InvalidCredentialsError } from './auth.errors';
import { findUserByEmail } from './auth.repository';

import type { SessionUser } from '@/server/auth/session';
import type { LoginInput } from './auth.schema';

export interface LoginResult {
  token: string;
  user: SessionUser;
}

export async function login(input: LoginInput): Promise<LoginResult> {
  const record = await findUserByEmail(input.email);
  if (!record) throw new InvalidCredentialsError();

  const passwordMatches = await verify(record.passwordHash, input.password);
  if (!passwordMatches) throw new InvalidCredentialsError();

  const user: SessionUser = {
    id: record.id,
    email: record.email,
    role: record.role,
  };
  const token = await createSessionToken(user);

  return { token, user };
}
