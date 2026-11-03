# smartlog-analyzer

Log ingestion and AI analysis service (Abstracta challenge). Design decisions live in `ARCHITECTURE.md`.

## Setup

```sh
docker compose up
```

Starts Postgres and the app on `http://localhost:3000`. On boot the container runs `prisma migrate deploy`, then the idempotent seed (skipped when `SEED_ON_START=false`), then the server. The database port is not published to the host; it is only reachable inside the `smartlog-net` network. Defaults come from `docker-compose.yml`; `.env.example` lists every variable.

### Local development without Docker for the app

`npm run dev` needs its own Postgres because compose does not publish 5432:

```sh
docker run -d --name smartlog-dev-db -p 5432:5432 -e POSTGRES_PASSWORD=smartlog \
  -e POSTGRES_USER=smartlog -e POSTGRES_DB=smartlog postgres:17-alpine
cp .env.example .env   # DATABASE_URL already points to localhost:5432
npm install && npm run db:migrate && npm run db:seed && npm run dev
```

### Seeded dev keys (send as `X-API-Key`)

| Service | Key | State |
|---|---|---|
| payments-api | `dev-key-payments-0001` | active |
| orders-api | `dev-key-orders-0002` | active |
| legacy-batch | `dev-key-legacy-0003` | inactive (401) |

## Tests

- `npm test`: unit tests, no Docker needed.
- `npm run test:integration`: starts Postgres with Testcontainers (Docker required) and runs the repository and seed tests against the real migration.

## How AI was used

Claude Code drafted the SDD artifacts and implementation for the Postgres/Docker slice. Rejected or corrected: a floating `prisma@latest` (an 8.x release candidate) in favour of the pinned 7.x line, and relaxing compiler flags to fit generated code (it was not needed).

## Left out

`logs`, `analyses` and N:M tables, the single in-flight analysis index (D15), startup recovery of `PROCESSING` rows, and `GET /api/health`. Each arrives with its first consumer.

## Not yet verified (needs Docker)

`docker compose up`, `npm run test:integration`, `docker stop` graceful shutdown, `SEED_ON_START=false`, and a bad `DATABASE_URL` aborting startup. See the change's verification checklist.
