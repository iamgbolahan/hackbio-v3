import type { BaselineParameter, TestCondition } from "generated/prisma/client";

// Proposal: a condition with fewer valid sessions than this is provisional and the fallback baseline is used.
export const MIN_SESSIONS_FOR_STABLE_SD = 6;

export interface BaselineSessionInput {
  astronautId: string;
  testCondition: TestCondition;
  sessionStartUtc: Date;
  valid: boolean;
  respRateBpm: number | null;
  spo2Pct: number | null;
  sbpMmhg: number | null;
  dbpMmhg: number | null;
}

export interface ComputedBaselineStat {
  astronautId: string;
  testCondition: TestCondition;
  parameter: BaselineParameter;
  mean: number;
  sd: number | null;
  n: number;
  provisional: boolean;
  collectedFrom: Date;
  collectedTo: Date;
}

const SESSION_VALUE: Record<
  BaselineParameter,
  (session: BaselineSessionInput) => number | null
> = {
  resp_rate_bpm: (s) => s.respRateBpm,
  spo2_pct: (s) => s.spo2Pct,
  sbp_mmhg: (s) => s.sbpMmhg,
  dbp_mmhg: (s) => s.dbpMmhg,
};

// Sample SD, s = sqrt(sum((x - mean)^2) / (n - 1)), as the proposal specifies.
function meanAndSampleSd(values: readonly number[]): {
  mean: number;
  sd: number | null;
} {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (values.length < 2) return { mean, sd: null };
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return { mean, sd: Math.sqrt(variance) };
}

// Mean and SD per astronaut, condition and parameter, from valid sessions only; conditions are never pooled.
export function computeBaselineStats(
  sessions: readonly BaselineSessionInput[],
): ComputedBaselineStat[] {
  const groups = new Map<string, BaselineSessionInput[]>();
  for (const session of sessions) {
    if (!session.valid) continue;
    const key = `${session.astronautId}|${session.testCondition}`;
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }

  const stats: ComputedBaselineStat[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    for (const parameter of Object.keys(SESSION_VALUE) as BaselineParameter[]) {
      const measured = group.filter(
        (s) => SESSION_VALUE[parameter](s) !== null,
      );
      if (measured.length === 0) continue;
      const { mean, sd } = meanAndSampleSd(
        measured.map((s) => SESSION_VALUE[parameter](s) as number),
      );
      const times = measured.map((s) => s.sessionStartUtc.getTime());
      stats.push({
        astronautId: first.astronautId,
        testCondition: first.testCondition,
        parameter,
        mean,
        sd,
        n: measured.length,
        provisional: measured.length < MIN_SESSIONS_FOR_STABLE_SD,
        collectedFrom: new Date(Math.min(...times)),
        collectedTo: new Date(Math.max(...times)),
      });
    }
  }
  return stats;
}
