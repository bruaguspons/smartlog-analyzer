-- CreateEnum
CREATE TYPE "log_level" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL');

-- CreateTable
CREATE TABLE "logs" (
    "id" UUID NOT NULL,
    "service_id" INTEGER NOT NULL,
    "level" "log_level" NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL,
    "message" TEXT NOT NULL,
    "trace_id" TEXT,
    "metadata" JSONB,

    CONSTRAINT "logs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "logs" ADD CONSTRAINT "logs_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
