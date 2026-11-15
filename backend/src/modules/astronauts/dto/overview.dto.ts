import type {
  ActivityLevel,
  HealthStatus,
  SignalQuality,
} from "generated/prisma/client";
import type { unavailable } from "../../metrics/metric-catalog";

export interface SingleReadingView {
  value: number;
  unit: string;
  // The personal reference this reading is compared with (in flight: the analog or adjusted baseline).
  baseline: number | null;
  deviationPct: number | null;
  status: HealthStatus;
}

export interface BloodPressureReadingView {
  systolic: number;
  diastolic: number;
  unit: "mmHg";
  baseline: { systolic: number; diastolic: number } | null;
  status: HealthStatus;
}

export interface GlucoseReadingView {
  value: number;
  unit: "mg/dL";
  fasting: boolean | null;
  // Glucose has no session baseline in the proposal; it is judged on the threshold table only.
  baseline: null;
  status: HealthStatus;
}

type OrUnavailable<T> = T | typeof unavailable;

export interface OverviewReadings {
  respiratoryRate: OrUnavailable<SingleReadingView>;
  oxygenSaturation: OrUnavailable<SingleReadingView>;
  bloodPressure: OrUnavailable<BloodPressureReadingView>;
  bloodGlucose: OrUnavailable<GlucoseReadingView>;
  heartRate: OrUnavailable<SingleReadingView>;
  skinTemperature: OrUnavailable<SingleReadingView>;
}

export interface OverviewResponse {
  astronautId: string;
  asOf: string | null;
  missionDay: number | null;
  inFlight: boolean | null;
  bioMonitorConnected: boolean;
  status: {
    level: HealthStatus;
    headline: string;
    activityLevel: ActivityLevel;
    reasons: string[];
    advice: string;
  } | null;
  sessionContext: {
    sessionId: string | null;
    baselineVerified: boolean;
    wearerAssociationConfirmed: boolean;
    signalQuality: SignalQuality | null;
  };
  readings: OverviewReadings | null;
}
