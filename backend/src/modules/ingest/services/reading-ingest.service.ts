import type {
  HealthStatus,
  Prisma,
  PrismaClient,
  SignalQuality,
  Source,
} from "generated/prisma/client";
import { NotFoundError } from "../../../middleware/error-handler";
import type { BaselineStatsService } from "../../baselines/services/baseline-stats.service";
import type { DailyAveragesService } from "../../trends/services/daily-averages.service";
import {
  parseStoredEvaluation,
  toStoredEvaluation,
} from "../../status/helpers/stored-evaluation";
import type { ReadingEvaluator } from "../../status/services/reading-evaluator";
import type { PreviousEvaluation } from "../../status/types";
import type { ReadingRecord } from "../dto/reading.dto";
import { resolveSignalQuality } from "../helpers/plausibility";

export type ReadingIngestOutcome =
  | {
      stored: true;
      signalQuality: SignalQuality;
      status: HealthStatus | null;
      explanation: string | null;
    }
  | { stored: false; duplicate: true };

const INSERT_CHUNK = 1000;

const duplicateKey = (timestampUtc: Date, source: Source) =>
  `${timestampUtc.toISOString()}|${source}`;

export interface ReadingIngestDependencies {
  prisma: PrismaClient;
  evaluator: ReadingEvaluator;
  baselineStats: BaselineStatsService;
  dailyAverages: DailyAveragesService;
  gapMinutes: number;
}

export class ReadingIngestService {
  private readonly prisma: PrismaClient;
  private readonly evaluator: ReadingEvaluator;
  private readonly baselineStats: BaselineStatsService;
  private readonly dailyAverages: DailyAveragesService;
  private readonly gapMinutes: number;

  constructor(deps: ReadingIngestDependencies) {
    this.prisma = deps.prisma;
    this.evaluator = deps.evaluator;
    this.baselineStats = deps.baselineStats;
    this.dailyAverages = deps.dailyAverages;
    this.gapMinutes = deps.gapMinutes;
  }

  async ingestOne(record: ReadingRecord): Promise<ReadingIngestOutcome> {
    const astronaut = await this.prisma.astronaut.findUnique({
      where: { id: record.astronautId },
    });
    if (!astronaut)
      throw new NotFoundError(
        "astronaut_not_found",
        `No astronaut with id ${record.astronautId}`,
      );
    const [outcome] = await this.ingestBatch([record]);
    if (!outcome)
      throw new Error("ingestBatch returned no outcome for a single record");
    return outcome;
  }

  // Outcomes come back in input order; callers must have checked that every astronaut exists.
  async ingestBatch(
    records: readonly ReadingRecord[],
  ): Promise<ReadingIngestOutcome[]> {
    const outcomes = new Array<ReadingIngestOutcome>(records.length);
    const indexesByAstronaut = new Map<string, number[]>();
    records.forEach((record, index) => {
      const indexes = indexesByAstronaut.get(record.astronautId);
      if (indexes) indexes.push(index);
      else indexesByAstronaut.set(record.astronautId, [index]);
    });

    for (const [astronautId, indexes] of indexesByAstronaut) {
      const ordered = indexes
        .map((index) => ({ index, record: records[index] as ReadingRecord }))
        .sort(
          (a, b) =>
            a.record.timestampUtc.getTime() - b.record.timestampUtc.getTime(),
        );
      const results = await this.ingestForAstronaut(
        astronautId,
        ordered.map((entry) => entry.record),
      );
      ordered.forEach((entry, position) => {
        outcomes[entry.index] = results[position] as ReadingIngestOutcome;
      });
    }
    return outcomes;
  }

  // Records must be sorted by time: persistence state and gap detection are threaded from one record to the next.
  private async ingestForAstronaut(
    astronautId: string,
    records: ReadingRecord[],
  ): Promise<ReadingIngestOutcome[]> {
    const first = records[0];
    const last = records[records.length - 1];
    if (!first || !last) return [];

    const [baselines, previousEvaluated, seen, lastTimeBySource] =
      await Promise.all([
        this.baselineStats.summaries(astronautId),
        this.previousEvaluation(astronautId, first.timestampUtc),
        this.existingKeys(astronautId, first.timestampUtc, last.timestampUtc),
        this.lastTimestampsBySource(astronautId, first.timestampUtc, records),
      ]);

    let previous = previousEvaluated;
    const readings: Prisma.ReadingCreateManyInput[] = [];
    const gaps: Prisma.DataGapCreateManyInput[] = [];
    const outcomes: ReadingIngestOutcome[] = [];

    for (const record of records) {
      const key = duplicateKey(record.timestampUtc, record.source);
      if (seen.has(key)) {
        outcomes.push({ stored: false, duplicate: true });
        continue;
      }
      seen.add(key);

      const gap = this.detectGap(lastTimeBySource.get(record.source), record);
      if (gap) gaps.push(gap);
      lastTimeBySource.set(record.source, record.timestampUtc);

      const signalQuality = resolveSignalQuality(record);
      if (signalQuality === "ARTIFACT") {
        readings.push({
          ...record,
          signalQuality,
          status: null,
          explanation: null,
        });
        outcomes.push({
          stored: true,
          signalQuality,
          status: null,
          explanation: null,
        });
        continue;
      }

      const evaluation = this.evaluator.evaluate({
        reading: record,
        previous,
        baselines,
      });
      previous = {
        timestampUtc: record.timestampUtc,
        parameters: evaluation.parameters,
      };
      readings.push({
        ...record,
        signalQuality,
        status: evaluation.status,
        evaluation: toStoredEvaluation(evaluation.parameters),
        explanation: evaluation.explanation,
      });
      outcomes.push({
        stored: true,
        signalQuality,
        status: evaluation.status,
        explanation: evaluation.explanation,
      });
    }

    await this.persist(readings, gaps);
    await this.dailyAverages.refreshDays(
      astronautId,
      readings.map((r) => new Date(r.timestampUtc)),
    );
    return outcomes;
  }

  private detectGap(
    lastTime: Date | undefined,
    record: ReadingRecord,
  ): Prisma.DataGapCreateManyInput | null {
    if (!lastTime) return null;
    const minutes = Math.round(
      (record.timestampUtc.getTime() - lastTime.getTime()) / 60_000,
    );
    if (minutes <= this.gapMinutes) return null;
    return {
      astronautId: record.astronautId,
      source: record.source,
      gapStart: lastTime,
      gapEnd: record.timestampUtc,
      minutes,
    };
  }

  private async persist(
    readings: Prisma.ReadingCreateManyInput[],
    gaps: Prisma.DataGapCreateManyInput[],
  ) {
    // skipDuplicates covers a concurrent insert of the same key between our duplicate check and this write.
    for (let start = 0; start < readings.length; start += INSERT_CHUNK) {
      await this.prisma.reading.createMany({
        data: readings.slice(start, start + INSERT_CHUNK),
        skipDuplicates: true,
      });
    }
    if (gaps.length > 0)
      await this.prisma.dataGap.createMany({
        data: gaps,
        skipDuplicates: true,
      });
  }

  private async previousEvaluation(
    astronautId: string,
    before: Date,
  ): Promise<PreviousEvaluation | null> {
    const reading = await this.prisma.reading.findFirst({
      where: {
        astronautId,
        timestampUtc: { lt: before },
        status: { not: null },
      },
      orderBy: { timestampUtc: "desc" },
      select: { timestampUtc: true, evaluation: true },
    });
    if (!reading) return null;
    return {
      timestampUtc: reading.timestampUtc,
      parameters: parseStoredEvaluation(reading.evaluation),
    };
  }

  private async existingKeys(
    astronautId: string,
    from: Date,
    to: Date,
  ): Promise<Set<string>> {
    const existing = await this.prisma.reading.findMany({
      where: { astronautId, timestampUtc: { gte: from, lte: to } },
      select: { timestampUtc: true, source: true },
    });
    return new Set(existing.map((r) => duplicateKey(r.timestampUtc, r.source)));
  }

  private async lastTimestampsBySource(
    astronautId: string,
    before: Date,
    records: readonly ReadingRecord[],
  ): Promise<Map<Source, Date>> {
    const sources = [...new Set(records.map((r) => r.source))];
    const latest = await Promise.all(
      sources.map((source) =>
        this.prisma.reading.findFirst({
          where: { astronautId, source, timestampUtc: { lt: before } },
          orderBy: { timestampUtc: "desc" },
          select: { source: true, timestampUtc: true },
        }),
      ),
    );
    return new Map(
      latest.flatMap((r) => (r ? [[r.source, r.timestampUtc] as const] : [])),
    );
  }
}
