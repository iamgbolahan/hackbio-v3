import type { ActivityLevel } from "generated/prisma/client";
import type {
  EvaluatedParameter,
  ParameterEvaluation,
  ParameterEvaluations,
} from "../types";
import { isWorse } from "./health-status";

const LABELS: Record<EvaluatedParameter, { name: string; unit: string }> = {
  resp_rate_bpm: { name: "Respiratory rate", unit: "breaths/min" },
  spo2_pct: { name: "SpO₂", unit: "%" },
  sbp_mmhg: { name: "Systolic blood pressure", unit: "mmHg" },
  dbp_mmhg: { name: "Diastolic blood pressure", unit: "mmHg" },
  glucose_mgdl: { name: "Blood glucose", unit: "mg/dL" },
};

function describeReading(parameter: EvaluatedParameter, value: number): string {
  const { name, unit } = LABELS[parameter];
  return unit === "%" ? `${name} ${value}%` : `${name} ${value} ${unit}`;
}

function minutesSince(since: string, now: Date): number {
  return Math.round((now.getTime() - Date.parse(since)) / 60_000);
}

function describeFlagged(
  parameter: EvaluatedParameter,
  evaluation: ParameterEvaluation,
  context: { activityLevel: ActivityLevel; now: Date },
): string {
  const reading = describeReading(parameter, evaluation.value);

  if (evaluation.escalatedByPersistence && evaluation.watchSince) {
    return `${reading} has stayed in the WATCH range for ${minutesSince(evaluation.watchSince, context.now)} min at ${context.activityLevel} activity; activity does not explain it.`;
  }
  if (evaluation.thresholdStatus === "ATTENTION")
    return `${reading} is in the ATTENTION range.`;
  if (
    evaluation.thresholdStatus === "WATCH" &&
    !evaluation.explainedByActivity
  ) {
    return `${reading} is in the WATCH range; monitoring whether it persists.`;
  }
  const baseline = evaluation.baseline;
  if (baseline?.sustained && baseline.deviationSince) {
    const direction = baseline.deviationPct > 0 ? "above" : "below";
    return `${reading} has been ${Math.abs(baseline.deviationPct).toFixed(1)}% ${direction} your personal baseline (${baseline.mean.toFixed(1)}) for ${minutesSince(baseline.deviationSince, context.now)} min.`;
  }
  return `${reading} needs review.`;
}

export function buildExplanation(
  parameters: ParameterEvaluations,
  context: { activityLevel: ActivityLevel; now: Date },
): string {
  const entries = Object.entries(parameters) as [
    EvaluatedParameter,
    ParameterEvaluation,
  ][];

  const flagged = entries
    .filter(([, evaluation]) => evaluation.status !== "NORMAL")
    .sort(([, a], [, b]) =>
      isWorse(a.status, b.status) ? -1 : isWorse(b.status, a.status) ? 1 : 0,
    );
  if (flagged.length > 0) {
    return flagged
      .map(([parameter, evaluation]) =>
        describeFlagged(parameter, evaluation, context),
      )
      .join(" ");
  }

  const explained = entries.filter(
    ([, evaluation]) => evaluation.explainedByActivity,
  );
  if (explained.length > 0) {
    return explained
      .map(
        ([parameter, evaluation]) =>
          `${describeReading(parameter, evaluation.value)} is raised but explained by ${context.activityLevel} activity.`,
      )
      .join(" ");
  }
  return "Measurements remain close to your baseline.";
}
