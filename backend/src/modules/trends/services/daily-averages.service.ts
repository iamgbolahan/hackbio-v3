import type { PrismaClient, StreamParameter } from "generated/prisma/client";

export interface DailyAverageRow {
  date: Date;
  parameter: StreamParameter;
  average: number;
  samples: number;
  missionDay: number | null;
}

export class DailyAveragesService {
  constructor(private readonly prisma: PrismaClient) {}

  // Recomputes whole days from stored readings, so repeated or concurrent ingests can never double count.
  async refreshDays(astronautId: string, days: readonly Date[]): Promise<void> {
    if (days.length === 0) return;
    const isoDays = [
      ...new Set(days.map((day) => day.toISOString().slice(0, 10))),
    ];
    await this.prisma.$executeRaw`
      INSERT INTO "daily_averages" ("astronautId", "date", "parameter", "sum", "count", "missionDay")
      SELECT r."astronautId", r."timestampUtc"::date, p.parameter::"StreamParameter", SUM(p.value), COUNT(p.value), MAX(r."missionDay")
      FROM "readings" r
      CROSS JOIN LATERAL (VALUES
        ('resp_rate_bpm', r."respRateBpm"),
        ('spo2_pct', r."spo2Pct"),
        ('sbp_mmhg', r."sbpMmhg"),
        ('dbp_mmhg', r."dbpMmhg"),
        ('glucose_mgdl', r."glucoseMgdl"),
        ('hr_bpm', r."hrBpm"),
        ('skin_temp_c', r."skinTempC")
      ) AS p(parameter, value)
      WHERE r."astronautId" = ${astronautId}
        AND r."signalQuality" <> 'ARTIFACT'
        AND p.value IS NOT NULL
        AND r."timestampUtc"::date = ANY(${isoDays}::date[])
      GROUP BY r."astronautId", r."timestampUtc"::date, p.parameter
      ON CONFLICT ("astronautId", "date", "parameter")
      DO UPDATE SET "sum" = EXCLUDED."sum", "count" = EXCLUDED."count", "missionDay" = EXCLUDED."missionDay"`;
  }

  async latestDay(astronautId: string): Promise<Date | null> {
    const latest = await this.prisma.dailyAverage.findFirst({
      where: { astronautId },
      orderBy: { date: "desc" },
      select: { date: true },
    });
    return latest?.date ?? null;
  }

  async between(
    astronautId: string,
    from: Date,
    to: Date,
  ): Promise<DailyAverageRow[]> {
    const rows = await this.prisma.dailyAverage.findMany({
      where: { astronautId, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
    });
    return rows.map((row) => ({
      date: row.date,
      parameter: row.parameter,
      average: row.sum / row.count,
      samples: row.count,
      missionDay: row.missionDay,
    }));
  }
}
