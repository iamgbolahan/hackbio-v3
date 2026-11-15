import type { BaselineParameter } from "generated/prisma/client";
import type { BaselineReference, BaselineStatSummary } from "../types";

// Microgravity-analog conditions, in order of preference, for in-flight comparison.
const FLIGHT_ANALOGS = ["head_down_tilt", "dry_immersion"] as const;

// Population fallback when no analog baseline exists: midpoints of the proposal's 8-14 mmHg SBP and 0-9 mmHg DBP falls.
const FLIGHT_SHIFT: Record<BaselineParameter, number> = {
  resp_rate_bpm: 0,
  spo2_pct: 0,
  sbp_mmhg: -11,
  dbp_mmhg: -4.5,
};

function usable(
  stat: BaselineStatSummary | undefined,
): stat is BaselineStatSummary & { sd: number } {
  return (
    stat !== undefined && !stat.provisional && stat.sd !== null && stat.sd > 0
  );
}

export function selectBaselineReference(
  stats: readonly BaselineStatSummary[],
  parameter: BaselineParameter,
  inFlight: boolean,
): BaselineReference | null {
  const forParameter = stats.filter((stat) => stat.parameter === parameter);

  if (inFlight) {
    for (const condition of FLIGHT_ANALOGS) {
      const analog = forParameter.find(
        (stat) => stat.testCondition === condition,
      );
      if (usable(analog))
        return {
          condition,
          adjustedForFlight: false,
          mean: analog.mean,
          sd: analog.sd,
        };
    }
  }

  const earth = forParameter.find(
    (stat) => stat.testCondition === "normal_earth",
  );
  if (!usable(earth)) return null;
  const shift = inFlight ? FLIGHT_SHIFT[parameter] : 0;
  return {
    condition: "normal_earth",
    adjustedForFlight: shift !== 0,
    mean: earth.mean + shift,
    sd: earth.sd,
  };
}
