/** Resolves when the database answers; rejects otherwise. */
export type DatabaseCheck = () => Promise<void>;

export interface HealthRouteOptions {
  checkDatabase: DatabaseCheck;
  timeoutMs?: number;
}
