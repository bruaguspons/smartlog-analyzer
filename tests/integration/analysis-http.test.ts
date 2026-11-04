import type { FastifyInstance } from "fastify";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from "vitest";
import type { Runtime } from "../../src/compose.js";
import { LlmError } from "../../src/modules/analysis/domain/llm-client.js";
import { PrismaAnalysisRepository } from "../../src/modules/analysis/infrastructure/prisma-analysis-repository.js";
import { createPrismaClient } from "../../src/shared/db/prisma-client.js";
import { analysisId, logId } from "../shared/analysis-repository-contract.js";
import {
  hangUntilAborted,
  okJson,
  ScriptedLlmClient,
  type ScriptStep,
} from "../shared/scripted-llm-client.js";
import {
  authHeaders as headers,
  buildIntegrationRuntime,
  resetDatabase,
} from "./support/integration-app.js";

/**
 * Analysis outcomes end to end: HTTP -> real composition -> Postgres, with only the LLM scripted.
 * Timeouts use a real short `LLM_TIMEOUT_MS`; the backoff sleep is instant (see the harness).
 * The 409 while an analysis is PROCESSING and boot-time recovery are covered in analysis-flow.test.ts.
 */
const prisma = createPrismaClient(inject("databaseUrl"));
const TIMEOUT_MS = 50;
const BASE = Date.parse("2026-11-04T09:00:00.000Z");

interface Started {
  id: string;
  hasMore: boolean;
  nextCursor: string | null;
}
interface AnalysisBody {
  status: string;
  summary: string | null;
  logCount: number;
  tokens: { prompt: number; completion: number } | null;
  error: { code: string } | null;
  findings: { category: string; severity: string; logIds: string[] }[];
}

let app: FastifyInstance;
let runner: Runtime["runner"];
let llm: ScriptedLlmClient;
let closed = false;

function build(
  options: {
    maxRetries?: number;
    timeoutMs?: number;
    onDisconnect?: () => Promise<void>;
  },
  ...script: ScriptStep[]
): void {
  llm = new ScriptedLlmClient(...script);
  ({ app, runner } = buildIntegrationRuntime({
    prisma,
    llm,
    timeoutMs: TIMEOUT_MS,
    ...options,
  }));
  closed = false;
}

const analyze = (payload: object = {}) =>
  app.inject({ method: "POST", url: "/api/logs/analyze", headers, payload });

/** Starts an analysis, expects 202, waits for its terminal write and returns the started body. */
async function run(payload: object = {}): Promise<Started> {
  const res = await analyze(payload);
  expect(res.statusCode).toBe(202);
  await runner.idle();
  return res.json<Started>();
}

const dbRow = (id: string) =>
  prisma.analysis.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      errorCode: true,
      rawResponse: true,
      promptTokens: true,
      completionTokens: true,
    },
  });

const analysisLogIds = async (id: string) =>
  (
    await prisma.analysisLog.findMany({
      where: { analysisId: id },
      select: { logId: true },
    })
  ).map((l) => l.logId);

async function view(id: string): Promise<AnalysisBody> {
  const res = await app.inject({
    method: "GET",
    url: `/api/analysis/${id}`,
    headers,
  });
  expect(res.statusCode).toBe(200);
  return res.json<AnalysisBody>();
}

/** Logs 1..count for service 1, log n at BASE + n seconds. */
async function seedLogs(count: number): Promise<void> {
  await prisma.log.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      id: logId(i + 1),
      serviceId: 1,
      level: "ERROR" as const,
      timestamp: new Date(BASE + (i + 1) * 1000),
      message: `log ${String(i + 1)}`,
    })),
  });
}

/** The id of the log the model saw as number `ref` (the prompt orders logs by timestamp DESC). */
const sentId = (ref: number): string => {
  const entry = llm.requests[0]?.entries[ref - 1];
  if (!entry) throw new Error(`no log numbered ${String(ref)} was sent`);
  return entry.log.id;
};

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterEach(async () => {
  if (closed) return;
  await runner.shutdown();
  await app.close();
});

describe("LLM outcomes persisted in Postgres", () => {
  it("an invalid structure fails with LLM_INVALID_RESPONSE after one call, keeping raw response and tokens", async () => {
    await seedLogs(3);
    const raw = '{"summary": 42}';
    build(
      { maxRetries: 3 },
      { text: raw, usage: { prompt: 7, completion: 3 } },
    );

    const { id } = await run();

    expect(llm.calls).toBe(1);
    expect(await dbRow(id)).toEqual({
      status: "FAILED",
      errorCode: "LLM_INVALID_RESPONSE",
      rawResponse: raw,
      promptTokens: 7,
      completionTokens: 3,
    });
    // The failure is visible through the API with its tokens, and the raw text is not.
    const body = await view(id);
    expect(body).toMatchObject({
      status: "FAILED",
      error: { code: "LLM_INVALID_RESPONSE" },
      tokens: { prompt: 7, completion: 3 },
    });
    expect(body).not.toHaveProperty("rawResponse");
    expect(body).not.toHaveProperty("raw_response");
  });

  it("text that is not JSON is also LLM_INVALID_RESPONSE with the text stored", async () => {
    await seedLogs(2);
    build({}, { text: "sorry, I cannot help", usage: null });

    const { id } = await run();

    expect(await dbRow(id)).toMatchObject({
      errorCode: "LLM_INVALID_RESPONSE",
      rawResponse: "sorry, I cannot help",
      promptTokens: null,
      completionTokens: null,
    });
  });

  it("a valid answer completes with raw response, tokens and findings linked to the sent logs", async () => {
    await seedLogs(3);
    const finding = {
      category: "DATABASE",
      severity: "HIGH",
      description: "pool exhausted",
      suggestions: ["grow it"],
      logRefs: [1, 2],
    };
    const answer = okJson(
      { summary: "Summary", findings: [finding] },
      { prompt: 20, completion: 9 },
    );
    build({}, answer);

    const { id, hasMore } = await run();

    expect(hasMore).toBe(false);
    expect(await dbRow(id)).toEqual({
      status: "COMPLETED",
      errorCode: null,
      rawResponse: answer.text,
      promptTokens: 20,
      completionTokens: 9,
    });
    const linked = (
      await prisma.findingLog.findMany({ select: { logId: true } })
    ).map((l) => l.logId);
    expect(linked.sort()).toEqual([sentId(1), sentId(2)].sort());
    expect(await analysisLogIds(id)).toEqual(expect.arrayContaining(linked));

    const body = await view(id);
    expect(body).toMatchObject({
      status: "COMPLETED",
      summary: "Summary",
      logCount: 3,
      tokens: { prompt: 20, completion: 9 },
      error: null,
    });
    expect(body.findings).toHaveLength(1);
    expect(body.findings[0]?.logIds.sort()).toEqual(
      [sentId(1), sentId(2)].sort(),
    );
    expect(body).not.toHaveProperty("rawResponse");
    expect(body).not.toHaveProperty("raw_response");
  });

  it("findings with no valid log ids are kept with no finding_logs rows", async () => {
    await seedLogs(2);
    const base = {
      category: "NETWORK",
      severity: "LOW",
      description: "d",
      suggestions: [],
    };
    build(
      {},
      okJson({
        summary: "s",
        findings: [
          { ...base, logRefs: [] },
          { ...base, logRefs: [99] },
        ],
      }),
    );

    const { id } = await run();

    expect((await dbRow(id)).status).toBe("COMPLETED");
    expect(await prisma.analysisFinding.count()).toBe(2);
    expect(await prisma.findingLog.count()).toBe(0);
    expect((await view(id)).findings.map((f) => f.logIds)).toEqual([[], []]);
  });

  it("unknown category and severity become OTHER/MEDIUM and foreign log refs are dropped", async () => {
    await seedLogs(2);
    const odd = {
      category: "cosmic-rays",
      severity: "apocalyptic",
      description: "d",
      suggestions: [],
      logRefs: [1, 99],
    };
    build({}, okJson({ summary: "s", findings: [odd] }));

    const { id } = await run();

    expect(
      await prisma.analysisFinding.findMany({
        select: { category: true, severity: true },
      }),
    ).toEqual([{ category: "OTHER", severity: "MEDIUM" }]);
    expect(
      (await prisma.findingLog.findMany({ select: { logId: true } })).map(
        (l) => l.logId,
      ),
    ).toEqual([sentId(1)]);
    expect((await view(id)).findings[0]?.logIds).toEqual([sentId(1)]);
  });

  it("an unknown analysis id is a 404 envelope", async () => {
    build({}, okJson({ summary: "s", findings: [] }));

    const res = await app.inject({
      method: "GET",
      url: `/api/analysis/${analysisId(404)}`,
      headers,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "NOT_FOUND",
    );
  });
});

describe("retries and timeouts with a real per-attempt timeout", () => {
  const unavailable = new LlmError("unavailable", "HTTP 503");
  const rateLimited = new LlmError("rate_limited", "HTTP 429");
  const rejected = new LlmError("rejected", "HTTP 400");
  const ok = okJson({ summary: "s", findings: [] });

  it("a timeout on every attempt (1 + retries) fails with LLM_TIMEOUT and no stored response", async () => {
    await seedLogs(2);
    build({ maxRetries: 3 }, hangUntilAborted);

    const { id } = await run();

    expect(llm.calls).toBe(4);
    expect(await dbRow(id)).toEqual({
      status: "FAILED",
      errorCode: "LLM_TIMEOUT",
      rawResponse: null,
      promptTokens: null,
      completionTokens: null,
    });
  });

  it("a timeout followed by a valid answer completes after two calls", async () => {
    await seedLogs(2);
    build({ maxRetries: 3 }, hangUntilAborted, ok);

    const { id } = await run();

    expect(llm.calls).toBe(2);
    expect((await dbRow(id)).status).toBe("COMPLETED");
  });

  // The persisted code follows the LAST attempt, whatever the earlier ones failed with.
  it.each<[string, number, ScriptStep[], string, number]>([
    [
      "503, 503, timeout",
      2,
      [unavailable, unavailable, hangUntilAborted],
      "LLM_TIMEOUT",
      3,
    ],
    [
      "timeout, timeout, 503",
      2,
      [hangUntilAborted, hangUntilAborted, unavailable],
      "LLM_UNAVAILABLE",
      3,
    ],
    ["429 on every attempt", 1, [rateLimited], "LLM_RATE_LIMITED", 2],
    ["503 on every attempt", 1, [unavailable], "LLM_UNAVAILABLE", 2],
    ["a 4xx is not retried", 3, [rejected], "LLM_REQUEST_REJECTED", 1],
  ])("$0 -> $3", async (_name, maxRetries, script, code, calls) => {
    await seedLogs(2);
    build({ maxRetries }, ...script);

    const { id } = await run();

    expect(llm.calls).toBe(calls);
    expect(await dbRow(id)).toMatchObject({
      status: "FAILED",
      errorCode: code,
    });
    expect((await view(id)).error?.code).toBe(code);
  });
});

describe("shutdown", () => {
  it("closing the app with an analysis in flight leaves it FAILED/INTERRUPTED in the database", async () => {
    await seedLogs(2);
    let idAtDisconnect = "";
    let rowAtDisconnect: Awaited<ReturnType<typeof dbRow>> | undefined;
    build(
      {
        timeoutMs: 60_000,
        onDisconnect: async () => {
          rowAtDisconnect = await dbRow(idAtDisconnect);
        },
      },
      hangUntilAborted,
    );
    const res = await analyze();
    expect(res.statusCode).toBe(202);
    const { id } = res.json<Started>();
    idAtDisconnect = id;
    await waitUntil(() => llm.calls === 1);
    expect((await dbRow(id)).status).toBe("PROCESSING");

    await app.close();
    closed = true;

    expect(await dbRow(id)).toMatchObject({
      status: "FAILED",
      errorCode: "INTERRUPTED",
    });
    // INTERRUPTED was already written when the pool disconnect step ran.
    expect(rowAtDisconnect).toMatchObject({
      status: "FAILED",
      errorCode: "INTERRUPTED",
    });
  });
});

describe("cursor continuation through analyze", () => {
  it("each page is disjoint, follows GET /api/logs order, and the last has no more", async () => {
    await seedLogs(5);
    build({}, okJson({ summary: "s", findings: [] }));

    const first = await run({ limit: 2 });
    expect(first.hasMore).toBe(true);
    const second = await run({ limit: 2, cursor: first.nextCursor });
    expect(second.hasMore).toBe(true);
    const third = await run({ limit: 2, cursor: second.nextCursor });
    expect(third.hasMore).toBe(false);
    expect(third.nextCursor).toBeNull();

    const pages = await Promise.all(
      [first, second, third].map((s) => analysisLogIds(s.id)),
    );
    expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
    expect(new Set(pages.flat()).size).toBe(5);

    const listed: string[] = [];
    let cursor = "";
    for (;;) {
      const res = await app.inject({
        method: "GET",
        url: `/api/logs?limit=2${cursor}`,
        headers,
      });
      const page = res.json<{
        items: { id: string }[];
        hasMore: boolean;
        nextCursor: string | null;
      }>();
      listed.push(...page.items.map((i) => i.id));
      if (!page.hasMore) break;
      cursor = `&cursor=${page.nextCursor ?? ""}`;
    }
    // analysis_logs has no row order: compare each page as a set against the matching slice of the listing.
    expect(pages.map((p) => p.sort())).toEqual([
      listed.slice(0, 2).sort(),
      listed.slice(2, 4).sort(),
      listed.slice(4).sort(),
    ]);
  });
});

describe("filters through analyze match GET /api/logs", () => {
  const at = (n: number) => new Date(BASE + n * 1000);

  beforeEach(async () => {
    await prisma.service.create({ data: { name: "other", apiKey: "key-2" } });
    const rows = [
      {
        n: 1,
        serviceId: 1,
        level: "INFO",
        message: "connected ok",
        traceId: null,
      },
      {
        n: 2,
        serviceId: 1,
        level: "ERROR",
        message: "db timeout",
        traceId: "t-1",
      },
      {
        n: 3,
        serviceId: 2,
        level: "ERROR",
        message: "upstream failed",
        traceId: "t-2",
      },
      { n: 4, serviceId: 2, level: "FATAL", message: "crash", traceId: "t-1" },
      {
        n: 5,
        serviceId: 1,
        level: "WARN",
        message: "slow query timeout",
        traceId: null,
      },
      { n: 6, serviceId: 2, level: "INFO", message: "ready", traceId: null },
    ] as const;
    await prisma.log.createMany({
      data: rows.map(({ n, ...rest }) => ({
        id: logId(n),
        timestamp: at(n),
        ...rest,
      })),
    });
  });

  it.each([
    ["serviceId", { serviceId: 2 }, "serviceId=2"],
    ["level[]", { level: ["ERROR", "FATAL"] }, "level=ERROR&level=FATAL"],
    [
      "from/to",
      { from: at(3).toISOString(), to: at(4).toISOString() },
      `from=${at(3).toISOString()}&to=${at(4).toISOString()}`,
    ],
    ["traceId", { traceId: "t-1" }, "traceId=t-1"],
    ["search", { search: "timeout" }, "search=timeout"],
  ])("%s", async (_name, payload, query) => {
    build({}, okJson({ summary: "s", findings: [] }));

    const { id } = await run(payload);

    const res = await app.inject({
      method: "GET",
      url: `/api/logs?limit=200&${query}`,
      headers,
    });
    const expected = res
      .json<{ items: { id: string }[] }>()
      .items.map((i) => i.id)
      .sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(6);
    expect((await analysisLogIds(id)).sort()).toEqual(expected);
  });
});

describe("terminal writes are compare-and-set", () => {
  // The row lock serializes both updates, so exactly one write wins on every iteration.
  it("concurrent complete and fail on one analysis leave exactly one winner and a consistent row", async () => {
    await seedLogs(2);
    build({}, okJson({ summary: "s", findings: [] }));
    const repo = new PrismaAnalysisRepository(prisma);
    const finding = {
      category: "OTHER" as const,
      severity: "LOW" as const,
      description: "d",
      suggestions: [],
      logIds: [logId(1)],
    };

    for (let i = 1; i <= 10; i += 1) {
      const id = analysisId(i);
      await repo.createProcessing(
        { id, provider: "p", model: "m", createdAt: new Date() },
        [logId(1), logId(2)],
      );

      const [completed, failed] = await Promise.all([
        repo.complete(id, {
          summary: "s",
          findings: [finding],
          rawResponse: "raw",
          usage: null,
          durationMs: 1,
        }),
        repo.fail(id, {
          errorCode: "INTERNAL_ERROR",
          errorMessage: "m",
          rawResponse: null,
          usage: null,
          durationMs: 1,
        }),
      ]);

      expect([completed, failed].filter(Boolean)).toHaveLength(1);
      const row = await dbRow(id);
      const findings = await prisma.analysisFinding.count({
        where: { analysisId: id },
      });
      if (completed) {
        expect(row).toMatchObject({ status: "COMPLETED", errorCode: null });
        expect(findings).toBe(1);
      } else {
        expect(row).toMatchObject({
          status: "FAILED",
          errorCode: "INTERNAL_ERROR",
        });
        expect(findings).toBe(0);
      }
    }
  });
});

/** Polls until `condition` holds (the job reaches the scripted LLM asynchronously after the 202). */
async function waitUntil(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i += 1)
    await new Promise((r) => setTimeout(r, 10));
  expect(condition()).toBe(true);
}
