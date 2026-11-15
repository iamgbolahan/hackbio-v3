import type { StreamParameter } from "generated/prisma/client";

// The one set of metric keys every read endpoint uses; the frontend's data-metric attributes match these.
export type MetricKey =
  | "heartRate"
  | "respiratoryRate"
  | "bloodPressure"
  | "skinTemperature"
  | "oxygenSaturation"
  | "bloodGlucose";

// Shown on the screens but not measured: the proposal's parameter list and the mock data leave them out.
export type UnavailableMetricKey = "heartRate" | "skinTemperature";

export type SingleValueMetricKey =
  "respiratoryRate" | "oxygenSaturation" | "bloodGlucose";

export const SINGLE_VALUE_METRICS: Record<
  SingleValueMetricKey,
  { parameter: StreamParameter; unit: string }
> = {
  respiratoryRate: { parameter: "resp_rate_bpm", unit: "breaths/min" },
  oxygenSaturation: { parameter: "spo2_pct", unit: "%" },
  bloodGlucose: { parameter: "glucose_mgdl", unit: "mg/dL" },
};

// Axis range the frontend scales its bars against (values from its demo data where it had one).
export const CHART_RANGE: Record<
  SingleValueMetricKey | "bloodPressure",
  { min: number; max: number }
> = {
  respiratoryRate: { min: 8, max: 22 },
  oxygenSaturation: { min: 90, max: 100 },
  bloodPressure: { min: 80, max: 150 },
  bloodGlucose: { min: 60, max: 160 },
};

export const unavailable = { status: "unavailable" } as const;
