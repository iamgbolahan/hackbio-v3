import type { Sex, TestCondition } from "generated/prisma/client";
import type { unavailable } from "../../metrics/metric-catalog";

// Shapes match what the frontend's profile.js already reads from /api/profile and /api/baseline.

export interface AstronautSummary {
  astronautId: string;
  displayName: string;
  crewNumber: string;
  sex: Sex;
  launchDay: number;
  missionName: string | null;
}

export interface StatusBadge<State extends string> {
  state: State;
  label: string;
}

export interface ProfileResponse {
  astronautId: string;
  displayName: string;
  crewNumber: string;
  sex: Sex;
  mission: { name: string } | null;
  identityStatus: { state: "verified"; description: string };
  baselineStatus: StatusBadge<"approved" | "pending">;
  deviceStatus: StatusBadge<"connected" | "disconnected">;
  updatedAt: string;
}

export interface MeanAndSd {
  mean: number;
  standardDeviation: number | null;
  n: number;
}

export interface BloodPressureMeanAndSd {
  mean: { systolicMmHg: number; diastolicMmHg: number };
  standardDeviation: {
    systolicMmHg: number | null;
    diastolicMmHg: number | null;
  };
  n: number;
}

export type BaselineCard<Values> =
  | (Values & { status: "approved" | "provisional"; referenceLabel: string })
  | typeof unavailable;

export interface BaselineParameters {
  heartRate: typeof unavailable;
  skinTemperature: typeof unavailable;
  respiratoryRate: BaselineCard<MeanAndSd>;
  oxygenSaturation: BaselineCard<MeanAndSd>;
  bloodPressure: BaselineCard<BloodPressureMeanAndSd>;
}

export interface BaselineConditionView {
  condition: TestCondition;
  respiratoryRate: BaselineCard<MeanAndSd>;
  oxygenSaturation: BaselineCard<MeanAndSd>;
  bloodPressure: BaselineCard<BloodPressureMeanAndSd>;
}

export interface BaselineResponse {
  approvalStatus: { label: string };
  methodDescription: string;
  // The normal-Earth reference, shown on the profile cards.
  parameters: BaselineParameters;
  byCondition: BaselineConditionView[];
}
