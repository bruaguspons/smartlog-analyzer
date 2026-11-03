export interface Service {
  id: number;
  name: string;
  description: string | null;
  /** Never expose in responses or logs (D7). */
  apiKey: string;
  isActive: boolean;
}
