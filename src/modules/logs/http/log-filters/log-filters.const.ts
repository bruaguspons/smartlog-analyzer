export const MAX_SEARCH_LENGTH = 256;
/** `services.id` is a Postgres Int4: larger values would overflow in the query and surface as a 500. */
export const MAX_SERVICE_ID = 2_147_483_647;

/**
 * Swagger UI has no date picker: `format: date-time` renders as a text input, pre-filled with
 * these examples. Together they cover every sample log of the dev seed (a unit test checks it),
 * so "Try it out" returns data without editing the dates.
 */
export const FROM_EXAMPLE = '2026-11-01T00:00:00Z';
export const TO_EXAMPLE = '2026-11-01T23:59:59Z';
