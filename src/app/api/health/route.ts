import { NextResponse } from 'next/server';

import { env } from '@/server/env';
import { logger } from '@/server/logger';

export const runtime = 'nodejs';

export function GET() {
  logger.info({ route: '/api/health' }, 'health check');
  return NextResponse.json({ status: 'ok', env: env.NODE_ENV });
}
