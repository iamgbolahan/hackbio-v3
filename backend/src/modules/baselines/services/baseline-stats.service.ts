import type { PrismaClient } from "generated/prisma/client";
import type { BaselineStatSummary } from "../../status/types";
import { computeBaselineStats } from "../helpers/baseline-statistics";

export class BaselineStatsService {
  constructor(private readonly prisma: PrismaClient) {}

  // Rebuilds the stored statistics from the astronaut's sessions, so re-uploading the same file is idempotent.
  async recompute(astronautId: string): Promise<number> {
    const sessions = await this.prisma.baselineSession.findMany({
      where: { astronautId },
    });
    const stats = computeBaselineStats(sessions);

    await this.prisma.$transaction([
      this.prisma.baselineStat.deleteMany({ where: { astronautId } }),
      this.prisma.baselineStat.createMany({ data: stats }),
    ]);
    return stats.length;
  }

  async summaries(astronautId: string): Promise<BaselineStatSummary[]> {
    return this.prisma.baselineStat.findMany({
      where: { astronautId },
      select: {
        testCondition: true,
        parameter: true,
        mean: true,
        sd: true,
        provisional: true,
      },
    });
  }
}
