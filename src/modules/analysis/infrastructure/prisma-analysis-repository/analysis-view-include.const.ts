import type { Prisma } from '@/shared/db/generated/client.js';

export const viewInclude = {
  findings: {
    orderBy: { id: 'asc' },
    include: { logs: { select: { logId: true }, orderBy: { logId: 'asc' } } },
  },
  _count: { select: { logs: true } },
} satisfies Prisma.AnalysisInclude;
