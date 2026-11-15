import type {
  BaselineParameter,
  BaselineStat,
  TestCondition,
} from "generated/prisma/client";
import { unavailable } from "../../metrics/metric-catalog";
import type {
  BaselineCard,
  BloodPressureMeanAndSd,
  MeanAndSd,
} from "../dto/profile.dto";

const round2 = (value: number) => Math.round(value * 100) / 100;
const roundSd = (sd: number | null) => (sd === null ? null : round2(sd));

function referenceLabel(stat: BaselineStat): string {
  return stat.provisional
    ? `Provisional: only ${stat.n} valid sessions`
    : "Verified pre-flight reference";
}

function find(
  stats: readonly BaselineStat[],
  condition: TestCondition,
  parameter: BaselineParameter,
) {
  return stats.find(
    (s) => s.testCondition === condition && s.parameter === parameter,
  );
}

export function singleValueCard(
  stats: readonly BaselineStat[],
  condition: TestCondition,
  parameter: BaselineParameter,
): BaselineCard<MeanAndSd> {
  const stat = find(stats, condition, parameter);
  if (!stat) return unavailable;
  return {
    status: stat.provisional ? "provisional" : "approved",
    mean: round2(stat.mean),
    standardDeviation: roundSd(stat.sd),
    n: stat.n,
    referenceLabel: referenceLabel(stat),
  };
}

export function bloodPressureCard(
  stats: readonly BaselineStat[],
  condition: TestCondition,
): BaselineCard<BloodPressureMeanAndSd> {
  const systolic = find(stats, condition, "sbp_mmhg");
  const diastolic = find(stats, condition, "dbp_mmhg");
  if (!systolic || !diastolic) return unavailable;
  const provisional = systolic.provisional || diastolic.provisional;
  return {
    status: provisional ? "provisional" : "approved",
    mean: {
      systolicMmHg: round2(systolic.mean),
      diastolicMmHg: round2(diastolic.mean),
    },
    standardDeviation: {
      systolicMmHg: roundSd(systolic.sd),
      diastolicMmHg: roundSd(diastolic.sd),
    },
    n: Math.min(systolic.n, diastolic.n),
    referenceLabel: referenceLabel(systolic.provisional ? systolic : diastolic),
  };
}
