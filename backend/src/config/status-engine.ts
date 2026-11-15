import type { AcuteParameter } from "../modules/status/types";
import { env } from "./env";

export interface StatusEngineConfig {
  // Minutes a WATCH must persist before escalating to ATTENTION; null means never escalate.
  persistenceMin: Record<AcuteParameter, number | null>;
  // Null keeps the personal-baseline layer informational: z and % deviation are reported but never change the status.
  baselineZLimit: number | null;
  gapMinutes: number;
}

export const statusEngineConfig: StatusEngineConfig = {
  persistenceMin: {
    resp_rate_bpm: env.PERSISTENCE_RESP_RATE_MIN,
    spo2_pct: env.PERSISTENCE_SPO2_MIN,
    sbp_mmhg: env.PERSISTENCE_SBP_MIN,
    glucose_mgdl: env.PERSISTENCE_GLUCOSE_MIN,
    hr_bpm: env.PERSISTENCE_HR_MIN,
    skin_temp_c: env.PERSISTENCE_SKIN_MIN,
  },
  baselineZLimit: env.BASELINE_Z_LIMIT,
  gapMinutes: env.GAP_MINUTES,
};
