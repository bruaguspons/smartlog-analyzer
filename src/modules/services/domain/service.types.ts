export interface Service {
  id: number;
  name: string;
  description: string | null;
  /** Stored in plain text, so never expose it in responses or logs. */
  apiKey: string;
  isActive: boolean;
}
