import { AppError } from './app-error.js';

export class ServiceUnavailableError extends AppError {
  constructor(message: string, details?: unknown) {
    super(503, 'SERVICE_UNAVAILABLE', message, details);
  }
}
