import { describe, expect, it } from "vitest";
import { THRESHOLDS } from "../../src/config/thresholds";
import { lookupThreshold } from "../../src/modules/status/helpers/threshold-lookup";

const statusOf = (...args: Parameters<typeof lookupThreshold>) =>
  lookupThreshold(...args)?.status ?? null;

describe("threshold table", () => {
  it("has the 47 rows transcribed from the proposal", () => {
    expect(THRESHOLDS).toHaveLength(47);
  });
});

describe("lookupThreshold", () => {
  it("rounds NEWS2-style bands before lookup", () => {
    expect(statusOf("resp_rate_bpm", ["any"], 20.4)).toBe("NORMAL");
    expect(statusOf("resp_rate_bpm", ["any"], 20.6)).toBe("WATCH");
    expect(statusOf("resp_rate_bpm", ["any"], 24.6)).toBe("ATTENTION");
  });

  it("marks RR WATCH bands as explainable by activity, SpO2 never", () => {
    expect(
      lookupThreshold("resp_rate_bpm", ["any"], 22)?.explainedByActivity,
    ).toBe(true);
    expect(lookupThreshold("spo2_pct", ["any"], 94)?.explainedByActivity).toBe(
      false,
    );
  });

  it("switches SBP limits between ground and flight", () => {
    expect(statusOf("sbp_mmhg", ["ground"], 108)).toBe("WATCH");
    expect(statusOf("sbp_mmhg", ["in_flight"], 108)).toBe("NORMAL");
    expect(statusOf("sbp_mmhg", ["in_flight"], 97)).toBe("WATCH");
    expect(statusOf("sbp_mmhg", ["in_flight"], 90)).toBe("ATTENTION");
  });

  it("takes the worst band across fasting and any-time glucose rows", () => {
    expect(statusOf("glucose_mgdl", ["fasting", "any_time"], 105)).toBe(
      "WATCH",
    );
    expect(statusOf("glucose_mgdl", ["non_fasting", "any_time"], 150)).toBe(
      "NORMAL",
    );
    expect(statusOf("glucose_mgdl", ["non_fasting", "any_time"], 60)).toBe(
      "WATCH",
    );
    expect(statusOf("glucose_mgdl", ["fasting", "any_time"], 54)).toBe("WATCH");
    expect(statusOf("glucose_mgdl", ["fasting", "any_time"], 53)).toBe(
      "ATTENTION",
    );
    expect(statusOf("glucose_mgdl", ["non_fasting", "any_time"], 200)).toBe(
      "ATTENTION",
    );
  });

  it("uses sex-specific LVEF limits", () => {
    expect(statusOf("lvef_pct", ["male"], 53)).toBe("NORMAL");
    expect(statusOf("lvef_pct", ["female"], 53)).toBe("WATCH");
    expect(statusOf("lvef_pct", ["female"], 29)).toBe("ATTENTION");
  });

  it("returns null inside the proposal's ONSD gap", () => {
    expect(statusOf("onsd_mm", ["ground", "any"], 5.75)).toBeNull();
    expect(statusOf("onsd_mm", ["ground", "any"], 6.0)).toBe("WATCH");
    expect(statusOf("onsd_mm", ["ground", "any"], 7.2)).toBe("ATTENTION");
  });

  it("respects exclusive edges on unrounded bands", () => {
    expect(statusOf("cimt_mm", ["any"], 0.9)).toBe("NORMAL");
    expect(statusOf("cimt_mm", ["any"], 0.91)).toBe("WATCH");
    expect(statusOf("muscle_loss_pct", ["any"], 3.99)).toBe("NORMAL");
    expect(statusOf("muscle_loss_pct", ["any"], 13.01)).toBe("ATTENTION");
  });
});
