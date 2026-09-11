import pino from 'pino';

import { env } from '@/server/env';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
});
