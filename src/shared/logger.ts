import pino from 'pino';
import { config } from '@/shared/config/config.js';

/** The API key travels in a request header, so it is redacted from every request log line. */
export const logger = pino({ level: config.logLevel, redact: ['req.headers["x-api-key"]'] });
