import type { Prisma } from '@/shared/db/generated/client.js';
import type { viewInclude } from './analysis-view-include.const.js';

export type AnalysisRow = Prisma.AnalysisGetPayload<{ include: typeof viewInclude }>;
