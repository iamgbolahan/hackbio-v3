import { describe, expect, it } from "vitest";
import type { StatusEngineConfig } from "../../src/config/status-engine";
import { selectBaselineReference } from "../../src/modules/status/helpers/baseline-reference";
import { ReadingEvaluator } from "../../src/modules/status/services/reading-evaluator";
import type {
  BaselineStatSummary,
  EvaluableReading,
  PreviousEvaluation,
  ReadingEvaluation,
} from "../../src/modules/status/types";

const config: StatusEngineConfig = {
  persistenceMin: {
    resp_rate_bpm: 30,
    spo2_pct: 30,
    sbp_mmhg: 60,
    glucose_mgdl: null,
  },
  baselineZLimit: 3,
  gapMinutes: 10,
};
const evaluator = new ReadingEvaluator(config);

const START = Date.parse("2026-10-21T11:00:00Z");

function reading(
  minute: number,
  overrides: Partial<EvaluableReading> = {},
): EvaluableReading {
  return {
    timestampUtc: new Date(START + minute * 60_000),
    inFlight: true,
    activityLevel: "low",
    respRateBpm: 15,
    spo2Pct: 98,
    sbpMmhg: 108,
    dbpMmhg: 68,
    glucoseMgdl: 90,
    fasting: false,
    ...overrides,
  };
}

// Feeds readings in order, threading each evaluation into the next as the "previous" state.
function run(
  readings: EvaluableReading[],
  baselines: BaselineStatSummary[] = [],
): ReadingEvaluation[] {
  let previous: PreviousEvaluation | null = null;
  return readings.map((r) => {
    const evaluation = evaluator.evaluate({ reading: r, previous, baselines });
    previous = {
      timestampUtc: r.timestampUtc,
      parameters: evaluation.parameters,
    };
    return evaluation;
  });
}

const everyFiveMinutes = (
  count: number,
  overrides: Partial<EvaluableReading>,
) => Array.from({ length: count }, (_, i) => reading(i * 5, overrides));

describe("ReadingEvaluator: thresholds and activity", () => {
  it("treats raised RR during exercise as explained by activity", () => {
    const [result] = run([
      reading(0, { activityLevel: "high", respRateBpm: 23 }),
    ]);
    expect(result?.status).toBe("NORMAL");
    expect(result?.parameters.resp_rate_bpm?.explainedByActivity).toBe(true);
    expect(result?.explanation).toContain("explained by high activity");
  });

  it("never lets activity explain SpO2", () => {
    const [result] = run([
      reading(0, { activityLevel: "moderate", spo2Pct: 91 }),
    ]);
    expect(result?.status).toBe("ATTENTION");
  });

  it("uses in-flight SBP limits only in flight", () => {
    expect(run([reading(0, { inFlight: true, sbpMmhg: 107 })])[0]?.status).toBe(
      "NORMAL",
    );
    expect(
      run([reading(0, { inFlight: false, sbpMmhg: 107 })])[0]?.status,
    ).toBe("WATCH");
  });
});

describe("ReadingEvaluator: persistence", () => {
  it("escalates RR at rest to ATTENTION once WATCH lasts 30 minutes", () => {
    const statuses = run(everyFiveMinutes(8, { respRateBpm: 23 })).map(
      (r) => r.status,
    );
    expect(statuses).toEqual([
      "WATCH",
      "WATCH",
      "WATCH",
      "WATCH",
      "WATCH",
      "WATCH",
      "ATTENTION",
      "ATTENTION",
    ]);
  });

  it("restarts the streak after a gap in the stream", () => {
    const readings = [
      reading(0, { respRateBpm: 23 }),
      reading(25, { respRateBpm: 23 }),
      reading(45, { respRateBpm: 23 }),
    ];
    expect(run(readings).map((r) => r.status)).toEqual([
      "WATCH",
      "WATCH",
      "WATCH",
    ]);
  });

  it("never escalates fasting glucose when its limit is null", () => {
    const statuses = run(
      everyFiveMinutes(48, { glucoseMgdl: 105, fasting: true }),
    ).map((r) => r.status);
    expect(new Set(statuses)).toEqual(new Set(["WATCH"]));
  });

  it("carries a streak across a record that did not measure the parameter", () => {
    const readings = [
      ...everyFiveMinutes(4, { respRateBpm: 23 }),
      reading(20, { respRateBpm: null }),
      reading(25, { respRateBpm: 23 }),
      reading(30, { respRateBpm: 23 }),
    ];
    const results = run(readings);
    expect(results[4]?.status).toBe("NORMAL");
    expect(results[6]?.status).toBe("ATTENTION");
  });
});

describe("ReadingEvaluator: personal baseline layer", () => {
  const baselines: BaselineStatSummary[] = [
    {
      testCondition: "normal_earth",
      parameter: "resp_rate_bpm",
      mean: 15,
      sd: 0.4,
      provisional: false,
    },
  ];

  it("raises WATCH when a resting deviation of 3 SD lasts past the persistence limit", () => {
    const results = run(
      everyFiveMinutes(7, { inFlight: false, sbpMmhg: 116, respRateBpm: 17 }),
      baselines,
    );
    expect(results[0]?.parameters.resp_rate_bpm?.baseline?.z).toBe(5);
    expect(results[5]?.status).toBe("NORMAL");
    expect(results[6]?.status).toBe("WATCH");
    expect(results[6]?.explanation).toContain("above your personal baseline");
  });

  it("does not compare non-resting readings with the resting baseline", () => {
    const results = run(
      everyFiveMinutes(7, {
        inFlight: false,
        sbpMmhg: 116,
        activityLevel: "moderate",
        respRateBpm: 17,
      }),
      baselines,
    );
    expect(results[6]?.parameters.resp_rate_bpm?.baseline).toBeNull();
    expect(results[6]?.status).toBe("NORMAL");
  });

  it("only reports the deviation when no z limit is configured", () => {
    const informational = new ReadingEvaluator({
      ...config,
      baselineZLimit: null,
    });
    let previous: PreviousEvaluation | null = null;
    let last: ReadingEvaluation | undefined;
    for (const r of everyFiveMinutes(12, {
      inFlight: false,
      sbpMmhg: 116,
      respRateBpm: 17,
    })) {
      last = informational.evaluate({ reading: r, previous, baselines });
      previous = { timestampUtc: r.timestampUtc, parameters: last.parameters };
    }
    expect(last?.parameters.resp_rate_bpm?.baseline?.z).toBe(5);
    expect(last?.parameters.resp_rate_bpm?.baseline?.deviationSince).toBeNull();
    expect(last?.status).toBe("NORMAL");
  });
});

describe("selectBaselineReference", () => {
  const stats: BaselineStatSummary[] = [
    {
      testCondition: "normal_earth",
      parameter: "sbp_mmhg",
      mean: 116,
      sd: 1.2,
      provisional: false,
    },
    {
      testCondition: "head_down_tilt",
      parameter: "sbp_mmhg",
      mean: 112,
      sd: 1.5,
      provisional: true,
    },
    {
      testCondition: "dry_immersion",
      parameter: "sbp_mmhg",
      mean: 110,
      sd: 1.4,
      provisional: false,
    },
  ];

  it("uses the Earth baseline on the ground", () => {
    expect(selectBaselineReference(stats, "sbp_mmhg", false)).toMatchObject({
      condition: "normal_earth",
      mean: 116,
    });
  });

  it("skips a provisional analog and uses the next one in flight", () => {
    expect(selectBaselineReference(stats, "sbp_mmhg", true)).toMatchObject({
      condition: "dry_immersion",
      mean: 110,
    });
  });

  it("falls back to the Earth baseline shifted by the population adjustment", () => {
    const earthOnly = stats.filter((s) => s.testCondition === "normal_earth");
    expect(selectBaselineReference(earthOnly, "sbp_mmhg", true)).toMatchObject({
      condition: "normal_earth",
      adjustedForFlight: true,
      mean: 105,
    });
  });
});
