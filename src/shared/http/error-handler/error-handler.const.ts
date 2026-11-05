export const INTERNAL_MESSAGE = 'Internal server error';

export const CLIENT_CODES: Record<number, string> = {
  401: 'UNAUTHORIZED',
  404: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
};
