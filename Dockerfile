FROM node:24-slim AS base
# Prisma's query compiler and schema engine expect OpenSSL on slim images.
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && apt-get clean
WORKDIR /app

FROM base AS build
# The schema must exist before `npm ci`: postinstall runs `prisma generate`.
COPY package.json package-lock.json prisma.config.ts ./
COPY db ./db
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json /app/prisma.config.ts ./
COPY --from=build --chown=node:node /app/db ./db
COPY --chown=node:node docker ./docker
USER node
EXPOSE 3000
ENTRYPOINT ["sh", "docker/entrypoint.sh"]
