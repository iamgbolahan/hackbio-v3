import {
  THRESHOLDS,
  type ThresholdContext,
  type ThresholdParameter,
  type ThresholdRow,
} from "../../../config/thresholds";
import { isWorse } from "./health-status";

function inRange(row: ThresholdRow, value: number): boolean {
  if (
    row.low !== null &&
    (row.lowInclusive ? value < row.low : value <= row.low)
  )
    return false;
  if (
    row.high !== null &&
    (row.highInclusive ? value > row.high : value >= row.high)
  )
    return false;
  return true;
}

// Worst matching row across the given contexts, or null when the table has no band for the value.
export function lookupThreshold(
  parameter: ThresholdParameter,
  contexts: readonly ThresholdContext[],
  value: number,
): ThresholdRow | null {
  let worst: ThresholdRow | null = null;
  for (const row of THRESHOLDS) {
    if (row.parameter !== parameter || !contexts.includes(row.context))
      continue;
    if (!inRange(row, row.roundToInteger ? Math.round(value) : value)) continue;
    if (!worst || isWorse(row.status, worst.status)) worst = row;
  }
  return worst;
}
