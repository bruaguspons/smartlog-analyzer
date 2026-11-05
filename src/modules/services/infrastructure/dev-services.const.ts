/** Fixed development keys, documented in docs/ejemplos-api.md. Never use them outside local dev. */
export const DEV_SERVICES = [
  { name: 'payments-api', description: 'Dev service (active)', apiKey: 'dev-key-payments-0001', isActive: true },
  { name: 'orders-api', description: 'Dev service (active)', apiKey: 'dev-key-orders-0002', isActive: true },
  { name: 'legacy-batch', description: 'Dev service (inactive)', apiKey: 'dev-key-legacy-0003', isActive: false },
] as const;
