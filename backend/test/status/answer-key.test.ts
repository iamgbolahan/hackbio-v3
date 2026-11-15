import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import type {
  ActivityLevel,
  HealthStatus,
  SignalQuality,
} from "generated/prisma/client";
import { describe, expect, it } from "vitest";
import type { StatusEngineConfig } from "../../src/config/status-engine";
import {
  computeBaselineStats,
  type BaselineSessionInput,
} from "../../src/modules/baselines/helpers/baseline-statistics";
import { ReadingEvaluator } from "../../src/modules/status/services/reading-evaluator";
import type { PreviousEvaluation } from "../../src/modules/status/types";

// Runs every mock stream row through the engine and checks it against expected_events.json.

const MOCK = join(__dirname, "../../data/mock");

interface StreamRow {
  timestamp_utc: string;
  astronaut_id: string;
  in_flight: string;
  activity_level: ActivityLevel;
  resp_rate_bpm: string;
  spo2_pct: string;
  sbp_mmhg: string;
  dbp_mmhg: string;
  glucose_mgdl: string;
  fasting: string;
  signal_quality: SignalQuality;
  scenario_tag: string;
}

interface StreamEvent {
  tag: string;
  id: string;
  records: number;
}

const config: StatusEngineConfig = {
  persistenceMin: {
    resp_rate_bpm: 30,
    spo2_pct: 30,
    sbp_mmhg: 60,
    glucose_mgdl: null,
  },
  baselineZLimit: null,
  gapMinutes: 10,
};

const numberOrNull = (value: string) => (value === "" ? null : Number(value));

function loadBaselines(): BaselineSessionInput[] {
  const rows = parse(readFileSync(join(MOCK, "mock_baseline_sessions.csv")), {
    columns: true,
  }) as Record<string, string>[];
  return rows.map((r) => ({
    astronautId: r.astronaut_id as string,
    testCondition: r.test_condition as BaselineSessionInput["testCondition"],
    sessionStartUtc: new Date(r.session_start_utc as string),
    valid: r.valid === "true",
    respRateBpm: numberOrNull(r.resp_rate_bpm as string),
    spo2Pct: numberOrNull(r.spo2_pct as string),
    sbpMmhg: numberOrNull(r.sbp_mmhg as string),
    dbpMmhg: numberOrNull(r.dbp_mmhg as string),
  }));
}

type Outcome = { row: StreamRow; status: HealthStatus | "ARTIFACT" };

function evaluateStream(): Outcome[] {
  const rows = parse(readFileSync(join(MOCK, "mock_realtime_stream.csv")), {
    columns: true,
  }) as StreamRow[];
  const stats = computeBaselineStats(loadBaselines());
  const evaluator = new ReadingEvaluator(config);
  const previousByAstronaut = new Map<string, PreviousEvaluation>();

  const ordered = [...rows].sort((a, b) =>
    a.timestamp_utc.localeCompare(b.timestamp_utc),
  );
  return ordered.map((row) => {
    if (row.signal_quality === "ARTIFACT") return { row, status: "ARTIFACT" };
    const timestampUtc = new Date(row.timestamp_utc);
    const evaluation = evaluator.evaluate({
      reading: {
        timestampUtc,
        inFlight: row.in_flight === "true",
        activityLevel: row.activity_level,
        respRateBpm: numberOrNull(row.resp_rate_bpm),
        spo2Pct: numberOrNull(row.spo2_pct),
        sbpMmhg: numberOrNull(row.sbp_mmhg),
        dbpMmhg: numberOrNull(row.dbp_mmhg),
        glucoseMgdl: numberOrNull(row.glucose_mgdl),
        fasting: row.fasting === "true",
      },
      previous: previousByAstronaut.get(row.astronaut_id) ?? null,
      baselines: stats.filter((s) => s.astronautId === row.astronaut_id),
    });
    previousByAstronaut.set(row.astronaut_id, {
      timestampUtc,
      parameters: evaluation.parameters,
    });
    return { row, status: evaluation.status };
  });
}

describe("engine against the mock answer key", () => {
  const outcomes = evaluateStream();
  const events = (
    JSON.parse(
      readFileSync(join(MOCK, "json/expected_events.json"), "utf8"),
    ) as { stream_events: StreamEvent[] }
  ).stream_events;
  const statusesFor = (tag: string) =>
    outcomes.filter((o) => o.row.scenario_tag === tag).map((o) => o.status);

  it("evaluates all 17,218 rows", () => {
    expect(outcomes).toHaveLength(17218);
  });

  it("keeps every untagged record NORMAL", () => {
    const unexpected = outcomes.filter(
      (o) => !o.row.scenario_tag && o.status !== "NORMAL",
    );
    const sample = unexpected
      .slice(0, 5)
      .map(
        (o) =>
          `${o.row.astronaut_id} ${o.row.timestamp_utc} ${o.row.activity_level} -> ${o.status}`,
      );
    expect(sample).toEqual([]);
    expect(unexpected).toHaveLength(0);
  });

  it("labels the expected number of records for each event", () => {
    for (const event of events)
      expect(statusesFor(event.tag)).toHaveLength(event.records);
  });

  it("rr_high_at_rest_sustained: WATCH, then ATTENTION after 30 minutes at rest", () => {
    const statuses = statusesFor("rr_high_at_rest_sustained");
    expect(statuses.slice(0, 6)).toEqual(Array(6).fill("WATCH"));
    expect(new Set(statuses.slice(6))).toEqual(new Set(["ATTENTION"]));
  });

  it("spo2_dip_watch: WATCH throughout (25 minutes, under the 30-minute limit)", () => {
    expect(new Set(statusesFor("spo2_dip_watch"))).toEqual(new Set(["WATCH"]));
  });

  it("hypoglycemia_event: WATCH, ATTENTION below 54, then back to NORMAL", () => {
    const statuses = statusesFor("hypoglycemia_event");
    expect(statuses).toContain("WATCH");
    expect(
      statuses.filter((s) => s === "ATTENTION").length,
    ).toBeGreaterThanOrEqual(6);
    const last = outcomes.findLastIndex(
      (o) => o.row.scenario_tag === "hypoglycemia_event",
    );
    const next = outcomes
      .slice(last + 1)
      .find((o) => o.row.astronaut_id === "A01");
    expect(next?.status).toBe("NORMAL");
  });

  it("sbp_low_inflight_watch and sbp_low_ground_watch: WATCH throughout", () => {
    expect(new Set(statusesFor("sbp_low_inflight_watch"))).toEqual(
      new Set(["WATCH"]),
    );
    expect(new Set(statusesFor("sbp_low_ground_watch"))).toEqual(
      new Set(["WATCH"]),
    );
  });

  it("fasting_glucose_elevated: WATCH on every morning, never escalated", () => {
    expect(new Set(statusesFor("fasting_glucose_elevated"))).toEqual(
      new Set(["WATCH"]),
    );
  });

  it("spo2_low_attention: ATTENTION immediately", () => {
    expect(new Set(statusesFor("spo2_low_attention"))).toEqual(
      new Set(["ATTENTION"]),
    );
  });

  it("sensor_artifact: stored as ARTIFACT, never evaluated", () => {
    expect(new Set(statusesFor("sensor_artifact"))).toEqual(
      new Set(["ARTIFACT"]),
    );
  });
});
