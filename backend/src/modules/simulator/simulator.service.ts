import type { PrismaClient } from "generated/prisma/client";
import { env } from "../../config/env";
import type { BaselineStatsService } from "../baselines/services/baseline-stats.service";
import type { ReadingRecord } from "../ingest/dto/reading.dto";
import type { ReadingIngestService } from "../ingest/services/reading-ingest.service";
import { missionDayFor } from "../auth/services/monitor-verification.service";
import { inDropout, sample, seedFor, type SimBaseline } from "./generator";

const STEP_MS = env.SIM_INTERVAL_SEC * 1000;
const COARSE_MS = 5 * 60_000;
const FINE_WINDOW_MS = 30 * 60_000;
const MAX_BACKFILL_MS = env.SIM_MAX_BACKFILL_HOURS * 3_600_000;
const CHUNK = 1000;

interface Primed {
  sessionId: string;
  lastTs: number;
}

// Plays the part of the Bio-Monitor: while an astronaut has a verified monitoring session it posts one reading
// every few seconds through the same ingest path a real device would use, and fills any gap when it starts.
export class SimulatorService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly primed = new Map<string, Primed>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly baselineStats: BaselineStatsService,
    private readonly ingest: ReadingIngestService,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), STEP_MS);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // Exposed so tests can drive the clock.
  async tick(now: number = Date.now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const sessions = await this.prisma.monitoringSession.findMany({
        where: { endedAt: null },
        include: { astronaut: true },
      });
      const open = new Set(sessions.map((session) => session.astronautId));
      for (const id of this.primed.keys()) if (!open.has(id)) this.primed.delete(id);

      for (const session of sessions) {
        const base = await this.baselineFor(session.astronautId);
        if (!base) continue;
        const ceiling = Math.floor(now / STEP_MS) * STEP_MS;
        let state = this.primed.get(session.astronautId);
        if (!state || state.sessionId !== session.sessionId) {
          const last = await this.prisma.reading.findFirst({
            where: { astronautId: session.astronautId },
            orderBy: { timestampUtc: "desc" },
            select: { timestampUtc: true },
          });
          state = {
            sessionId: session.sessionId,
            lastTs: last ? last.timestampUtc.getTime() : ceiling - FINE_WINDOW_MS,
          };
          this.primed.set(session.astronautId, state);
        }
        const records = this.recordsBetween(
          session.astronautId,
          session.astronaut.launchDay,
          session.sessionId,
          base,
          state.lastTs,
          ceiling,
        );
        for (let i = 0; i < records.length; i += CHUNK)
          await this.ingest.ingestBatch(records.slice(i, i + CHUNK));
        state.lastTs = ceiling;
      }
    } catch (error) {
      console.error("simulator tick failed", error);
    } finally {
      this.running = false;
    }
  }

  // One-off history from mission day 1 up to now at ten-minute spacing, one monitoring-session id per day.
  // Safe to run twice: duplicates are ignored by the ingest path.
  async backfillHistory(astronautId: string): Promise<{ records: number; stored: number }> {
    const astronaut = await this.prisma.astronaut.findUnique({ where: { id: astronautId } });
    const base = astronaut ? await this.baselineFor(astronautId) : null;
    if (!astronaut || !base) return { records: 0, stored: 0 };
    const seed = seedFor(astronautId);
    const step = 10 * 60_000;
    const start = Date.parse(`${env.MISSION_START_DATE}T00:00:00Z`);
    const end = Math.floor((Date.now() - FINE_WINDOW_MS) / step) * step;
    const records: ReadingRecord[] = [];
    for (let t = start + step; t <= end; t += step) {
      const day = String(missionDayFor(new Date(t))).padStart(2, "0");
      this.push(records, astronautId, astronaut.launchDay, `${astronautId}-D${day}`, base, seed, t);
    }
    let stored = 0;
    for (let i = 0; i < records.length; i += CHUNK) {
      const outcomes = await this.ingest.ingestBatch(records.slice(i, i + CHUNK));
      stored += outcomes.filter((outcome) => outcome.stored).length;
    }
    return { records: records.length, stored };
  }

  private recordsBetween(
    astronautId: string,
    launchDay: number,
    sessionId: string,
    base: SimBaseline,
    fromExclusive: number,
    toInclusive: number,
  ): ReadingRecord[] {
    const seed = seedFor(astronautId);
    const records: ReadingRecord[] = [];
    const start = Math.max(fromExclusive, toInclusive - MAX_BACKFILL_MS);
    const fineFrom = toInclusive - FINE_WINDOW_MS;
    // Coarse five-minute steps for the old part of the gap, then full-rate readings for the last half hour.
    let t = Math.floor(start / COARSE_MS) * COARSE_MS + COARSE_MS;
    for (; t <= toInclusive && t < fineFrom; t += COARSE_MS)
      if (t > fromExclusive) this.push(records, astronautId, launchDay, sessionId, base, seed, t);
    t = Math.max(Math.ceil(Math.max(fineFrom, start) / STEP_MS) * STEP_MS, fromExclusive + STEP_MS);
    for (; t <= toInclusive; t += STEP_MS)
      this.push(records, astronautId, launchDay, sessionId, base, seed, t);
    return records;
  }

  private push(
    out: ReadingRecord[],
    astronautId: string,
    launchDay: number,
    sessionId: string,
    base: SimBaseline,
    seed: number,
    t: number,
  ): void {
    if (inDropout(seed, t)) return; // the sensor was off: no record, like a real feed
    const date = new Date(t);
    const missionDay = missionDayFor(date);
    const s = sample(seed, base, t, {
      inFlight: missionDay >= launchDay,
      frequentEpisodes: env.SIM_DEMO_EPISODES,
    });
    out.push({
      timestampUtc: date,
      astronautId,
      sessionId,
      source: "mock",
      inFlight: missionDay >= launchDay,
      activityLevel: s.activityLevel,
      respRateBpm: s.respRateBpm,
      spo2Pct: s.spo2Pct,
      sbpMmhg: s.sbpMmhg,
      dbpMmhg: s.dbpMmhg,
      glucoseMgdl: s.glucoseMgdl,
      fasting: s.fasting,
      signalQuality: s.signalQuality,
      missionDay,
      scenarioTag: s.scenarioTag,
    });
  }

  private async baselineFor(astronautId: string): Promise<SimBaseline | null> {
    const stats = await this.baselineStats.summaries(astronautId);
    const mean = (parameter: string) =>
      stats.find((s) => s.testCondition === "normal_earth" && s.parameter === parameter)?.mean;
    const rr = mean("resp_rate_bpm");
    const spo2 = mean("spo2_pct");
    const sbp = mean("sbp_mmhg");
    const dbp = mean("dbp_mmhg");
    if (rr === undefined || spo2 === undefined || sbp === undefined || dbp === undefined)
      return null;
    return { rr, spo2, sbp, dbp };
  }
}
