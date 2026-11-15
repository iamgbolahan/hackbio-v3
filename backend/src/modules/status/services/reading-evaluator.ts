import type { HealthStatus } from "generated/prisma/client";
import type { ThresholdContext } from "../../../config/thresholds";
import type { StatusEngineConfig } from "../../../config/status-engine";
import { selectBaselineReference } from "../helpers/baseline-reference";
import { buildExplanation } from "../helpers/explanation";
import { worstStatus } from "../helpers/health-status";
import { lookupThreshold } from "../helpers/threshold-lookup";
import type {
  AcuteParameter,
  BaselineDeviation,
  BaselineStatSummary,
  EvaluableReading,
  EvaluatedParameter,
  ParameterEvaluation,
  ParameterEvaluations,
  PreviousEvaluation,
  ReadingEvaluation,
} from "../types";

export interface EvaluationInput {
  reading: EvaluableReading;
  // The astronaut's previous evaluated reading, or null if there is none.
  previous: PreviousEvaluation | null;
  baselines: readonly BaselineStatSummary[];
}

const VALUE_OF: Record<
  EvaluatedParameter,
  (reading: EvaluableReading) => number | null
> = {
  resp_rate_bpm: (r) => r.respRateBpm,
  spo2_pct: (r) => r.spo2Pct,
  sbp_mmhg: (r) => r.sbpMmhg,
  dbp_mmhg: (r) => r.dbpMmhg,
  glucose_mgdl: (r) => r.glucoseMgdl,
};

function minutesBetween(since: string, now: Date): number {
  return (now.getTime() - Date.parse(since)) / 60_000;
}

function thresholdContexts(
  parameter: AcuteParameter,
  reading: EvaluableReading,
): ThresholdContext[] {
  switch (parameter) {
    case "sbp_mmhg":
      return [reading.inFlight ? "in_flight" : "ground"];
    case "glucose_mgdl":
      return [reading.fasting ? "fasting" : "non_fasting", "any_time"];
    default:
      return ["any"];
  }
}

export class ReadingEvaluator {
  constructor(private readonly config: StatusEngineConfig) {}

  evaluate({
    reading,
    previous,
    baselines,
  }: EvaluationInput): ReadingEvaluation {
    // A gap in the stream is "no data", not evidence that a deviation persisted, so streaks restart.
    const continuous =
      previous !== null &&
      minutesBetween(
        previous.timestampUtc.toISOString(),
        reading.timestampUtc,
      ) <= this.config.gapMinutes;
    const previousParameters = continuous ? previous.parameters : {};

    const measured: ParameterEvaluations = {};
    const carried: ParameterEvaluations = {};
    for (const parameter of Object.keys(VALUE_OF) as EvaluatedParameter[]) {
      const value = VALUE_OF[parameter](reading);
      const previousParameter = previousParameters[parameter];
      if (value !== null) {
        measured[parameter] = this.evaluateParameter(parameter, value, {
          reading,
          previous: previousParameter ?? null,
          baselines,
        });
      } else if (previousParameter) {
        // Not measured this time (e.g. the glucose sensor sends separately), so the streak carries over.
        carried[parameter] = previousParameter;
      }
    }

    return {
      status: worstStatus(
        Object.values(measured).map((evaluation) => evaluation.status),
      ),
      explanation: buildExplanation(measured, {
        activityLevel: reading.activityLevel,
        now: reading.timestampUtc,
      }),
      parameters: { ...carried, ...measured },
    };
  }

  private evaluateParameter(
    parameter: EvaluatedParameter,
    value: number,
    context: {
      reading: EvaluableReading;
      previous: ParameterEvaluation | null;
      baselines: readonly BaselineStatSummary[];
    },
  ): ParameterEvaluation {
    const { reading, previous } = context;
    const now = reading.timestampUtc;
    const limit = this.persistenceLimit(parameter);

    const row =
      parameter === "dbp_mmhg"
        ? null
        : lookupThreshold(
            parameter,
            thresholdContexts(parameter, reading),
            value,
          );
    const explainedByActivity =
      row?.status === "WATCH" &&
      row.explainedByActivity &&
      reading.activityLevel !== "low";
    const instant: HealthStatus = explainedByActivity
      ? "NORMAL"
      : (row?.status ?? "NORMAL");

    const watchSince =
      instant === "NORMAL" ? null : (previous?.watchSince ?? now.toISOString());
    const escalatedByPersistence =
      instant === "WATCH" &&
      limit !== null &&
      watchSince !== null &&
      minutesBetween(watchSince, now) >= limit;

    const baseline = this.baselineDeviation(parameter, value, context);
    const baselineStatus: HealthStatus = baseline?.sustained
      ? "WATCH"
      : "NORMAL";

    return {
      value,
      thresholdStatus: row?.status ?? null,
      explainedByActivity,
      watchSince,
      escalatedByPersistence,
      baseline,
      status: worstStatus([
        escalatedByPersistence ? "ATTENTION" : instant,
        baselineStatus,
      ]),
    };
  }

  // Second layer: compares a resting reading with the astronaut's own baseline (proposal: "Applying the Thresholds").
  private baselineDeviation(
    parameter: EvaluatedParameter,
    value: number,
    context: {
      reading: EvaluableReading;
      previous: ParameterEvaluation | null;
      baselines: readonly BaselineStatSummary[];
    },
  ): BaselineDeviation | null {
    const { reading, previous, baselines } = context;
    // Baselines are resting values, and glucose has no session baseline.
    if (parameter === "glucose_mgdl" || reading.activityLevel !== "low")
      return null;
    const reference = selectBaselineReference(
      baselines,
      parameter,
      reading.inFlight,
    );
    if (!reference) return null;

    const now = reading.timestampUtc;
    const z = (value - reference.mean) / reference.sd;
    const zLimit = this.config.baselineZLimit;
    const deviating = zLimit !== null && Math.abs(z) >= zLimit;
    const deviationSince = deviating
      ? (previous?.baseline?.deviationSince ?? now.toISOString())
      : null;
    const limit = this.persistenceLimit(parameter);

    return {
      ...reference,
      z: Number(z.toFixed(2)),
      deviationPct: Number(
        (((value - reference.mean) / reference.mean) * 100).toFixed(2),
      ),
      deviationSince,
      sustained:
        limit !== null &&
        deviationSince !== null &&
        minutesBetween(deviationSince, now) >= limit,
    };
  }

  private persistenceLimit(parameter: EvaluatedParameter): number | null {
    // DBP has no acute limits of its own, so it shares the SBP persistence window.
    return this.config.persistenceMin[
      parameter === "dbp_mmhg" ? "sbp_mmhg" : parameter
    ];
  }
}
