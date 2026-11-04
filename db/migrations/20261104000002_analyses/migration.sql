-- CreateEnum
CREATE TYPE "analysis_status" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "analysis_finding_category" AS ENUM ('DATABASE', 'NETWORK', 'TIMEOUT', 'EXTERNAL_DEPENDENCY', 'AUTHENTICATION', 'VALIDATION', 'RESOURCE_EXHAUSTION', 'PERFORMANCE', 'CONFIGURATION', 'APPLICATION_ERROR', 'SECURITY', 'DATA_INTEGRITY', 'OTHER');

-- CreateEnum
CREATE TYPE "analysis_finding_severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "analyses" (
    "id" UUID NOT NULL,
    "status" "analysis_status" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "raw_response" TEXT,
    "summary" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_ms" INTEGER,

    CONSTRAINT "analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_logs" (
    "analysis_id" UUID NOT NULL,
    "log_id" UUID NOT NULL,

    CONSTRAINT "analysis_logs_pkey" PRIMARY KEY ("analysis_id","log_id")
);

-- CreateTable
CREATE TABLE "analysis_findings" (
    "id" SERIAL NOT NULL,
    "analysis_id" UUID NOT NULL,
    "category" "analysis_finding_category" NOT NULL,
    "severity" "analysis_finding_severity" NOT NULL,
    "description" TEXT NOT NULL,
    "suggestions" JSONB NOT NULL,

    CONSTRAINT "analysis_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding_logs" (
    "finding_id" INTEGER NOT NULL,
    "log_id" UUID NOT NULL,

    CONSTRAINT "finding_logs_pkey" PRIMARY KEY ("finding_id","log_id")
);

-- CreateIndex
-- Partial unique index (D15): at most one row can be PROCESSING. Declared in schema.prisma with
-- `where: raw(...)` (preview feature `partialIndexes`); keep it when regenerating this migration.
CREATE UNIQUE INDEX "analyses_single_processing" ON "analyses"("status") WHERE (status = 'PROCESSING');

-- CreateIndex
CREATE INDEX "analysis_logs_log_id_idx" ON "analysis_logs"("log_id");

-- CreateIndex
CREATE INDEX "analysis_findings_analysis_id_idx" ON "analysis_findings"("analysis_id");

-- AddForeignKey
ALTER TABLE "analysis_logs" ADD CONSTRAINT "analysis_logs_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_logs" ADD CONSTRAINT "analysis_logs_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_findings" ADD CONSTRAINT "analysis_findings_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_logs" ADD CONSTRAINT "finding_logs_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "analysis_findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_logs" ADD CONSTRAINT "finding_logs_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

