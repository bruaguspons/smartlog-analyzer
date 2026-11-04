import { Prisma, type PrismaClient } from '../../../shared/db/generated/client.js';
import type { AnalysisErrorCode, AnalysisView, NewAnalysis } from '../domain/analysis.js';
import type {
  AnalysisRepository,
  CompleteInput,
  CreateProcessingOutcome,
  FailInput,
} from '../domain/analysis-repository.js';

const UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION;
}

const viewInclude = {
  findings: {
    orderBy: { id: 'asc' },
    include: { logs: { select: { logId: true }, orderBy: { logId: 'asc' } } },
  },
  _count: { select: { logs: true } },
} satisfies Prisma.AnalysisInclude;

type AnalysisRow = Prisma.AnalysisGetPayload<{ include: typeof viewInclude }>;

function toView(row: AnalysisRow): AnalysisView {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    durationMs: row.durationMs,
    logCount: row._count.logs,
    provider: row.provider,
    model: row.model,
    summary: row.summary,
    findings: row.findings.map((f) => ({
      id: f.id,
      category: f.category,
      severity: f.severity,
      description: f.description,
      // Written only by this repository from a validated string[], so the narrow cast is safe.
      suggestions: f.suggestions as string[],
      logIds: f.logs.map((l) => l.logId),
    })),
    tokens:
      row.promptTokens !== null && row.completionTokens !== null
        ? { prompt: row.promptTokens, completion: row.completionTokens }
        : null,
    error:
      row.errorCode !== null
        ? // Written only by this repository from the AnalysisErrorCode union.
          { code: row.errorCode as AnalysisErrorCode, message: row.errorMessage ?? '' }
        : null,
  };
}

export class PrismaAnalysisRepository implements AnalysisRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async createProcessing(analysis: NewAnalysis, logIds: readonly string[]): Promise<CreateProcessingOutcome> {
    try {
      // A nested create runs as one transaction: the analysis never exists without its logs.
      await this.prisma.analysis.create({
        data: {
          id: analysis.id,
          status: 'PROCESSING',
          provider: analysis.provider,
          model: analysis.model,
          createdAt: analysis.createdAt,
          logs: { createMany: { data: logIds.map((logId) => ({ logId })) } },
        },
        select: { id: true },
      });
      return { created: true };
    } catch (error) {
      // The partial unique index is the only unique constraint besides the primary key, so any
      // P2002 means another analysis is PROCESSING.
      if (!isUniqueViolation(error)) throw error;
      const running = await this.prisma.analysis.findFirst({ where: { status: 'PROCESSING' }, select: { id: true } });
      return { created: false, runningId: running?.id ?? null };
    }
  }

  complete(id: string, input: CompleteInput): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.analysis.updateMany({
        where: { id, status: 'PROCESSING' },
        data: {
          status: 'COMPLETED',
          summary: input.summary,
          rawResponse: input.rawResponse,
          promptTokens: input.usage?.prompt ?? null,
          completionTokens: input.usage?.completion ?? null,
          durationMs: input.durationMs,
        },
      });
      if (count === 0) return false;

      // App-level invariant (the database does not enforce it): a finding's logs belong to its analysis.
      const analysisLogs = await tx.analysisLog.findMany({ where: { analysisId: id }, select: { logId: true } });
      const allowed = new Set(analysisLogs.map((l) => l.logId));
      if (input.findings.some((f) => f.logIds.some((logId) => !allowed.has(logId)))) {
        // Throwing rolls back the status update too, so no partial result is left behind.
        throw new Error('A finding references a log outside the analysis');
      }

      for (const finding of input.findings) {
        await tx.analysisFinding.create({
          data: {
            analysisId: id,
            category: finding.category,
            severity: finding.severity,
            description: finding.description,
            suggestions: finding.suggestions,
            logs: { createMany: { data: finding.logIds.map((logId) => ({ logId })) } },
          },
          select: { id: true },
        });
      }
      return true;
    });
  }

  async fail(id: string, input: FailInput): Promise<boolean> {
    const { count } = await this.prisma.analysis.updateMany({
      where: { id, status: 'PROCESSING' },
      data: {
        status: 'FAILED',
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        rawResponse: input.rawResponse,
        promptTokens: input.usage?.prompt ?? null,
        completionTokens: input.usage?.completion ?? null,
        durationMs: input.durationMs,
      },
    });
    return count > 0;
  }

  async failAllProcessing(input: { errorCode: 'INTERRUPTED'; errorMessage: string }): Promise<string[]> {
    const rows = await this.prisma.analysis.updateManyAndReturn({
      where: { status: 'PROCESSING' },
      data: { status: 'FAILED', errorCode: input.errorCode, errorMessage: input.errorMessage },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async findById(id: string): Promise<AnalysisView | null> {
    const row = await this.prisma.analysis.findUnique({ where: { id }, include: viewInclude });
    return row ? toView(row) : null;
  }
}
