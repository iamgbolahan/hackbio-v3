import type { HealthStatus } from "generated/prisma/client";

// Transcribed from the proposal's threshold table via data/mock/thresholds_transcribed_from_proposal.csv; prototype rules, not validated medical limits.

export type ThresholdParameter =
  | "resp_rate_bpm"
  | "spo2_pct"
  | "sbp_mmhg"
  | "glucose_mgdl"
  | "hr_bpm"
  | "skin_temp_c"
  | "sbp_mmhg_resting"
  | "dbp_mmhg_resting"
  | "ijv_flow_grade"
  | "ijv_area_mm2"
  | "onsd_mm"
  | "cimt_mm"
  | "lvef_pct"
  | "muscle_loss_pct";

export type ThresholdContext =
  | "any"
  | "ground"
  | "in_flight"
  | "fasting"
  | "non_fasting"
  | "any_time"
  | "male"
  | "female";

export interface ThresholdRow {
  parameter: ThresholdParameter;
  context: ThresholdContext;
  status: HealthStatus;
  low: number | null;
  high: number | null;
  lowInclusive: boolean;
  highInclusive: boolean;
  explainedByActivity: boolean;
  roundToInteger: boolean;
}

const row = (
  parameter: ThresholdParameter,
  context: ThresholdContext,
  status: HealthStatus,
  [low, high]: [number | null, number | null],
  bounds: {
    lowInclusive: boolean;
    highInclusive: boolean;
    explainedByActivity?: boolean;
    roundToInteger?: boolean;
  },
): ThresholdRow => ({
  parameter,
  context,
  status,
  low,
  high,
  lowInclusive: bounds.lowInclusive,
  highInclusive: bounds.highInclusive,
  explainedByActivity: bounds.explainedByActivity ?? false,
  roundToInteger: bounds.roundToInteger ?? false,
});

const closed = { lowInclusive: true, highInclusive: true };
const closedInt = { ...closed, roundToInteger: true };
const atMostInt = {
  lowInclusive: false,
  highInclusive: true,
  roundToInteger: true,
};
const atLeastInt = {
  lowInclusive: true,
  highInclusive: false,
  roundToInteger: true,
};

export const THRESHOLDS: readonly ThresholdRow[] = [
  // A. Real-time (acute) parameters, NEWS2-style integer bands.
  row("resp_rate_bpm", "any", "NORMAL", [12, 20], closedInt),
  row("resp_rate_bpm", "any", "WATCH", [9, 11], {
    ...closedInt,
    explainedByActivity: true,
  }),
  row("resp_rate_bpm", "any", "WATCH", [21, 24], {
    ...closedInt,
    explainedByActivity: true,
  }),
  row("resp_rate_bpm", "any", "ATTENTION", [null, 8], atMostInt),
  row("resp_rate_bpm", "any", "ATTENTION", [25, null], atLeastInt),

  row("spo2_pct", "any", "NORMAL", [96, 100], closedInt),
  row("spo2_pct", "any", "WATCH", [92, 95], closedInt),
  row("spo2_pct", "any", "ATTENTION", [null, 91], atMostInt),

  row("sbp_mmhg", "ground", "NORMAL", [111, 219], closedInt),
  row("sbp_mmhg", "ground", "WATCH", [91, 110], closedInt),
  row("sbp_mmhg", "ground", "ATTENTION", [null, 90], atMostInt),
  row("sbp_mmhg", "ground", "ATTENTION", [220, null], atLeastInt),
  row("sbp_mmhg", "in_flight", "NORMAL", [101, 219], closedInt),
  row("sbp_mmhg", "in_flight", "WATCH", [91, 100], closedInt),
  row("sbp_mmhg", "in_flight", "ATTENTION", [null, 90], atMostInt),
  row("sbp_mmhg", "in_flight", "ATTENTION", [220, null], atLeastInt),

  row("glucose_mgdl", "fasting", "NORMAL", [70, 99], closedInt),
  row("glucose_mgdl", "fasting", "WATCH", [100, 199], closedInt),
  // Assumption from the mock pack: the proposal has no non-fasting NORMAL band, so post-meal 70-199 is NORMAL.
  row("glucose_mgdl", "non_fasting", "NORMAL", [70, 199], closedInt),
  row("glucose_mgdl", "any_time", "WATCH", [54, 69], closedInt),
  row("glucose_mgdl", "any_time", "ATTENTION", [null, 54], {
    lowInclusive: false,
    highInclusive: false,
    roundToInteger: true,
  }),
  row("glucose_mgdl", "any_time", "ATTENTION", [200, null], atLeastInt),

  // Heart rate and skin temperature are not in the proposal: provisional bands from published ISS data
  // (resting in-flight heart rate equals pre-flight supine; core temperature rises about 1 C in flight).
  row("hr_bpm", "any", "NORMAL", [50, 99], closedInt),
  row("hr_bpm", "any", "WATCH", [100, 179], { ...closedInt, explainedByActivity: true }),
  row("hr_bpm", "any", "WATCH", [40, 49], closedInt),
  row("hr_bpm", "any", "ATTENTION", [null, 39], atMostInt),
  row("hr_bpm", "any", "ATTENTION", [180, null], atLeastInt),

  row("skin_temp_c", "any", "NORMAL", [32.0, 36.6], { lowInclusive: true, highInclusive: false }),
  row("skin_temp_c", "any", "WATCH", [36.6, 37.5], { lowInclusive: true, highInclusive: false, explainedByActivity: true }),
  row("skin_temp_c", "any", "WATCH", [30.5, 32.0], { lowInclusive: true, highInclusive: false }),
  row("skin_temp_c", "any", "ATTENTION", [null, 30.5], { lowInclusive: false, highInclusive: false }),
  row("skin_temp_c", "any", "ATTENTION", [37.5, null], { lowInclusive: true, highInclusive: false }),

  // B. Resting blood pressure, judged on resting measurements and daily averages.
  row("sbp_mmhg_resting", "any", "NORMAL", [90, 119], closedInt),
  row("sbp_mmhg_resting", "any", "WATCH", [120, 180], {
    ...closedInt,
    explainedByActivity: true,
  }),
  row("sbp_mmhg_resting", "any", "ATTENTION", [180, null], {
    lowInclusive: false,
    highInclusive: false,
    roundToInteger: true,
  }),
  row("dbp_mmhg_resting", "any", "NORMAL", [60, 79], closedInt),
  row("dbp_mmhg_resting", "any", "WATCH", [80, 120], {
    ...closedInt,
    explainedByActivity: true,
  }),
  row("dbp_mmhg_resting", "any", "ATTENTION", [120, null], {
    lowInclusive: false,
    highInclusive: false,
    roundToInteger: true,
  }),

  // C. Scheduled ultrasound measurements.
  // Assumption from the mock pack: the proposal only lists grades 3 and 4, so grades 1-2 are NORMAL.
  row("ijv_flow_grade", "any", "NORMAL", [1, 2], closedInt),
  row("ijv_flow_grade", "any", "WATCH", [3, 3], closedInt),
  row("ijv_flow_grade", "any", "ATTENTION", [4, 4], closedInt),
  row("ijv_area_mm2", "ground", "NORMAL", [0.7, 18.9], closed),
  row("onsd_mm", "ground", "NORMAL", [5.0, 5.7], closed),
  row("onsd_mm", "ground", "WATCH", [5.8, 7.2], {
    lowInclusive: false,
    highInclusive: false,
  }),
  row("onsd_mm", "any", "ATTENTION", [7.2, null], {
    lowInclusive: true,
    highInclusive: false,
  }),
  row("cimt_mm", "any", "NORMAL", [0.46, 0.9], closed),
  row("cimt_mm", "any", "WATCH", [0.9, 1.5], {
    lowInclusive: false,
    highInclusive: true,
  }),
  row("cimt_mm", "any", "ATTENTION", [1.5, null], {
    lowInclusive: false,
    highInclusive: false,
  }),
  row("lvef_pct", "male", "NORMAL", [52, 72], closed),
  row("lvef_pct", "male", "WATCH", [30, 52], {
    lowInclusive: true,
    highInclusive: false,
  }),
  row("lvef_pct", "male", "ATTENTION", [null, 30], {
    lowInclusive: false,
    highInclusive: false,
  }),
  row("lvef_pct", "female", "NORMAL", [54, 74], closed),
  row("lvef_pct", "female", "WATCH", [30, 54], {
    lowInclusive: true,
    highInclusive: false,
  }),
  row("lvef_pct", "female", "ATTENTION", [null, 30], {
    lowInclusive: false,
    highInclusive: false,
  }),
  row("muscle_loss_pct", "any", "NORMAL", [null, 4], {
    lowInclusive: false,
    highInclusive: false,
  }),
  row("muscle_loss_pct", "any", "WATCH", [4, 13], closed),
  // Prototype choice: the dataset gives no value beyond 13% loss.
  row("muscle_loss_pct", "any", "ATTENTION", [13, null], {
    lowInclusive: false,
    highInclusive: false,
  }),
];
