import type { SignalQuality } from "generated/prisma/client";
import type { ReadingRecord } from "../dto/reading.dto";

// Physically implausible values, suggested by the mock pack (not the proposal); such records are stored as ARTIFACT.
const PLAUSIBLE: Record<
  "respRateBpm" | "spo2Pct" | "sbpMmhg" | "dbpMmhg" | "glucoseMgdl",
  [number, number]
> = {
  respRateBpm: [4, 60],
  spo2Pct: [50, 100],
  sbpMmhg: [50, 260],
  dbpMmhg: [20, 160],
  glucoseMgdl: [20, 600],
};

export function resolveSignalQuality(record: ReadingRecord): SignalQuality {
  if (record.signalQuality === "ARTIFACT") return "ARTIFACT";
  for (const [field, [low, high]] of Object.entries(PLAUSIBLE) as [
    keyof typeof PLAUSIBLE,
    [number, number],
  ][]) {
    const value = record[field];
    if (value !== null && (value < low || value > high)) return "ARTIFACT";
  }
  return record.signalQuality;
}
