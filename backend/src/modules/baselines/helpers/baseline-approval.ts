import type { BaselineParameter } from "generated/prisma/client";
import type { BaselineStatSummary } from "../../status/types";

const REQUIRED: readonly BaselineParameter[] = [
  "resp_rate_bpm",
  "spo2_pct",
  "sbp_mmhg",
  "dbp_mmhg",
];

// Approved = a stable (non-provisional) normal-Earth reference exists for every baseline parameter.
export function isBaselineApproved(
  stats: readonly BaselineStatSummary[],
): boolean {
  return REQUIRED.every((parameter) =>
    stats.some(
      (s) =>
        s.testCondition === "normal_earth" &&
        s.parameter === parameter &&
        !s.provisional,
    ),
  );
}
