import { AppError } from './app-error.js';

/** Same message for missing, unknown and inactive keys, so it reveals nothing. */
export class UnauthorizedError extends AppError {
  constructor() {
    super(401, 'UNAUTHORIZED', 'Invalid or missing API key');
  }
}
