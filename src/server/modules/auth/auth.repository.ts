import { prisma } from '@/server/db/prisma';

import type { Role } from '@/generated/prisma/enums';

export interface AuthenticatableUser {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
}

export async function findUserByEmail(
  email: string,
): Promise<AuthenticatableUser | null> {
  return prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, passwordHash: true, role: true },
  });
}
