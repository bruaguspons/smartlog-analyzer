export interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

export interface ErrorResponse {
  statusCode: number;
  body: ErrorEnvelope;
}
