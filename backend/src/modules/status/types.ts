import type {
  ActivityLevel,
  BaselineParameter,
  HealthStatus,
  TestCondition,
} from "generated/prisma/client";

// Parameters checked against the threshold table on every reading.
export type AcuteParameter =
  "resp_rate_bpm" | "spo2_pct" | "sbp_mmhg" | "glucose_mgdl" | "hr_bpm" | "skin_temp_c";

// Everything the real-time engine evaluates: acute parameters plus DBP, which only has a baseline layer.
export type EvaluatedParameter = AcuteParameter | "dbp_mmhg";

export interface EvaluableReading {
  timestampUtc: Date;
  inFlight: boolean;
  activityLevel: ActivityLevel;
  respRateBpm: number | null;
  spo2Pct: number | null;
  sbpMmhg: number | null;
  dbpMmhg: number | null;
  glucoseMgdl: number | null;
  hrBpm?: number | null;
  skinTempC?: number | null;
  fasting: boolean | null;
}

export interface BaselineStatSummary {
  testCondition: TestCondition;
  parameter: BaselineParameter;
  mean: number;
  sd: number | null;
  provisional: boolean;
}

export interface BaselineReference {
  condition: TestCondition;
  // True when the Earth baseline was shifted by the population in-flight adjustment.
  adjustedForFlight: boolean;
  mean: number;
  sd: number;
}

export interface BaselineDeviation extends BaselineReference {
  z: number;
  deviationPct: number;
  deviationSince: string | null;
  sustained: boolean;
}

export interface ParameterEvaluation {
  value: number;
  // Null when the threshold table has no band for this value (or no rows at all, as for DBP).
  thresholdStatus: HealthStatus | null;
  explainedByActivity: boolean;
  watchSince: string | null;
  escalatedByPersistence: boolean;
  baseline: BaselineDeviation | null;
  status: HealthStatus;
}

export type ParameterEvaluations = Partial<
  Record<EvaluatedParameter, ParameterEvaluation>
>;

export interface ReadingEvaluation {
  status: HealthStatus;
  explanation: string;
  parameters: ParameterEvaluations;
}

// What the engine needs from the astronaut's previous evaluated reading to track persistence.
export interface PreviousEvaluation {
  timestampUtc: Date;
  parameters: ParameterEvaluations;
}
