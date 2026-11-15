import type { HealthStatus } from "generated/prisma/client";
import { z } from "zod";
import type {
  SingleValueMetricKey,
  UnavailableMetricKey,
  unavailable,
} from "../../metrics/metric-catalog";

export type TrendPeriod = 7 | 30;

export const trendsQuerySchema = z.object({
  period: z
    .enum(["7", "30"])
    .transform((value): TrendPeriod => (value === "7" ? 7 : 30)),
});

export interface SingleValueTrend {
  status: "available";
  unit: string;
  min: number;
  max: number;
  days: {
    date: string;
    missionDay: number | null;
    value: number;
    samples: number;
  }[];
}

export interface BloodPressureTrend {
  status: "available";
  unit: "mmHg";
  min: number;
  max: number;
  // Resting-BP status of the daily average (proposal table B: chronic limits apply to daily averages).
  days: {
    date: string;
    missionDay: number | null;
    systolic: number;
    diastolic: number;
    status: HealthStatus;
  }[];
}

export interface UltrasoundTrendPoint {
  timestampUtc: string;
  missionDay: number | null;
  inFlight: boolean;
  status: HealthStatus;
  ijvAreaMm2: number | null;
  ijvFlowGrade: number | null;
  onsdMm: number | null;
  onsdBaselineMm: number | null;
  cimtMm: number | null;
  lvefPct: number | null;
  muscleThicknessMm: number | null;
  muscleLossPct: number | null;
}

export interface TrendsResponse {
  period: TrendPeriod;
  asOf: string | null;
  metrics: Record<SingleValueMetricKey, SingleValueTrend> &
    Record<UnavailableMetricKey, typeof unavailable> & {
      bloodPressure: BloodPressureTrend;
    };
  ultrasound: UltrasoundTrendPoint[];
}
