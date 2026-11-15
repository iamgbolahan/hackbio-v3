import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BaselineParameter, TestCondition } from "generated/prisma/client";
import { describe, expect, it } from "vitest";
import {
  computeBaselineStats,
  type BaselineSessionInput,
} from "../../src/modules/baselines/helpers/baseline-statistics";

const MOCK = join(__dirname, "../../data/mock/json");

interface MockSession {
  astronaut_id: string;
  test_condition: TestCondition;
  session_start_utc: string;
  valid: boolean;
  resp_rate_bpm: number;
  spo2_pct: number;
  sbp_mmhg: number;
  dbp_mmhg: number;
}

type ExpectedGroup = {
  astronaut_id: string;
  test_condition: TestCondition;
  n_valid_sessions: number;
  provisional: boolean;
} & Record<BaselineParameter, { n: number; mean: number; sd: number }>;

const sessions: BaselineSessionInput[] = (
  JSON.parse(
    readFileSync(join(MOCK, "baseline_sessions.json"), "utf8"),
  ) as MockSession[]
).map((s) => ({
  astronautId: s.astronaut_id,
  testCondition: s.test_condition,
  sessionStartUtc: new Date(s.session_start_utc),
  valid: s.valid,
  respRateBpm: s.resp_rate_bpm,
  spo2Pct: s.spo2_pct,
  sbpMmhg: s.sbp_mmhg,
  dbpMmhg: s.dbp_mmhg,
}));

const expected = JSON.parse(
  readFileSync(join(MOCK, "expected_baseline_stats.json"), "utf8"),
) as ExpectedGroup[];

describe("computeBaselineStats against the mock answer key", () => {
  const stats = computeBaselineStats(sessions);

  it("produces one row per astronaut x condition x parameter", () => {
    expect(stats).toHaveLength(expected.length * 4);
  });

  for (const group of expected) {
    it(`${group.astronaut_id} ${group.test_condition} matches mean, sample SD and n`, () => {
      for (const parameter of [
        "resp_rate_bpm",
        "spo2_pct",
        "sbp_mmhg",
        "dbp_mmhg",
      ] as const) {
        const stat = stats.find(
          (s) =>
            s.astronautId === group.astronaut_id &&
            s.testCondition === group.test_condition &&
            s.parameter === parameter,
        );
        expect(stat?.n).toBe(group[parameter].n);
        expect(stat?.mean).toBeCloseTo(group[parameter].mean, 2);
        expect(stat?.sd).toBeCloseTo(group[parameter].sd, 2);
        expect(stat?.provisional).toBe(group.provisional);
      }
    });
  }

  it("marks only A02 reduced_pressure as provisional", () => {
    const provisional = new Set(
      stats
        .filter((s) => s.provisional)
        .map((s) => `${s.astronautId}|${s.testCondition}`),
    );
    expect([...provisional]).toEqual(["A02|reduced_pressure"]);
  });
});
