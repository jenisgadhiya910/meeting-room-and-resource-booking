import type { prisma } from '@/server/db/prisma';
import type { Prisma } from '@/generated/prisma/client';
import type { AuditAction } from '@/generated/prisma/enums';

export interface AuditEventInput {
  actorId: string;
  action: AuditAction;
  outcome: string;
  roomId: string | null;
  bookingId: string | null;
  requestId: string | null;
  payload: Prisma.InputJsonValue;
}

// Takes whichever client the caller is already inside, never opens its own —
// the transaction client for an event that must commit-or-rollback with the
// change it describes, or the global `prisma` singleton for one written
// after a rollback (see security-and-audit.md: a rejected-overlap event must
// never be written inside the transaction that just failed).
export async function writeAuditEvent(
  client: Pick<typeof prisma, 'auditEvent'>,
  input: AuditEventInput,
): Promise<void> {
  await client.auditEvent.create({ data: input });
}
