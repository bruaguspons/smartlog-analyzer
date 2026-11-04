-- Index names match the Prisma defaults, so `migrate diff` reports no drift.

-- CreateIndex
CREATE INDEX "logs_timestamp_id_idx" ON "logs"("timestamp" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "logs_service_id_timestamp_id_idx" ON "logs"("service_id", "timestamp" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "logs_level_timestamp_idx" ON "logs"("level", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "logs_trace_id_idx" ON "logs"("trace_id");
