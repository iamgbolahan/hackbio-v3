import type { HealthStatus, Sex } from "generated/prisma/client";
import { worstStatus } from "../helpers/health-status";
import { lookupThreshold } from "../helpers/threshold-lookup";

// Proposal: in flight, ONSD WATCH is set relative to the astronaut's own pre-flight baseline plus this rise.
export const ONSD_IN_FLIGHT_RISE_MM = 0.91;

export interface UltrasoundMeasurements {
  inFlight: boolean;
  ijvFlowGrade: number | null;
  onsdMm: number | null;
  cimtMm: number | null;
  lvefPct: number | null;
  muscleThicknessMm: number | null;
}

export interface PreFlightReference {
  onsdMm: number | null;
  muscleThicknessMm: number | null;
}

export interface UltrasoundEvaluation {
  status: HealthStatus;
  muscleLossPct: number | null;
  explanation: string;
}

interface Finding {
  status: HealthStatus;
  text: string;
}

const mean = (values: number[]) =>
  values.length === 0
    ? null
    : values.reduce((sum, v) => sum + v, 0) / values.length;

// Pre-flight reference = mean of the astronaut's ground scans for each measurement.
export function preFlightReference(
  groundScans: readonly UltrasoundMeasurements[],
): PreFlightReference {
  return {
    onsdMm: mean(
      groundScans.flatMap((s) => (s.onsdMm === null ? [] : [s.onsdMm])),
    ),
    muscleThicknessMm: mean(
      groundScans.flatMap((s) =>
        s.muscleThicknessMm === null ? [] : [s.muscleThicknessMm],
      ),
    ),
  };
}

function onsdFinding(
  onsdMm: number,
  inFlight: boolean,
  reference: PreFlightReference,
): Finding | null {
  if (lookupThreshold("onsd_mm", ["any"], onsdMm)?.status === "ATTENTION") {
    return {
      status: "ATTENTION",
      text: `ONSD ${onsdMm} mm is at or above 7.2 mm.`,
    };
  }
  if (!inFlight) {
    const row = lookupThreshold("onsd_mm", ["ground"], onsdMm);
    if (row?.status === "WATCH")
      return { status: "WATCH", text: `ONSD ${onsdMm} mm is above 5.8 mm.` };
    if (!row)
      return {
        status: "NORMAL",
        text: `ONSD ${onsdMm} mm falls in a gap of the threshold table (5.7-5.8 mm).`,
      };
    return null;
  }
  if (reference.onsdMm === null) return null;
  const limit = reference.onsdMm + ONSD_IN_FLIGHT_RISE_MM;
  if (onsdMm <= limit) return null;
  return {
    status: "WATCH",
    text: `ONSD ${onsdMm} mm exceeds your pre-flight baseline ${reference.onsdMm.toFixed(2)} + ${ONSD_IN_FLIGHT_RISE_MM} mm.`,
  };
}

export function evaluateUltrasound(
  scan: UltrasoundMeasurements,
  context: { sex: Sex; reference: PreFlightReference },
): UltrasoundEvaluation {
  const findings: Finding[] = [];

  if (scan.ijvFlowGrade !== null) {
    const status = lookupThreshold(
      "ijv_flow_grade",
      ["any"],
      scan.ijvFlowGrade,
    )?.status;
    if (status === "WATCH")
      findings.push({ status, text: `IJV flow grade 3 (stasis).` });
    if (status === "ATTENTION")
      findings.push({
        status,
        text: `IJV flow grade 4 (reverse flow or clot).`,
      });
  }
  if (scan.onsdMm !== null) {
    const finding = onsdFinding(scan.onsdMm, scan.inFlight, context.reference);
    if (finding) findings.push(finding);
  }
  if (scan.cimtMm !== null) {
    const status = lookupThreshold("cimt_mm", ["any"], scan.cimtMm)?.status;
    if (status && status !== "NORMAL")
      findings.push({
        status,
        text: `cIMT ${scan.cimtMm} mm is in the ${status} range.`,
      });
  }
  if (scan.lvefPct !== null) {
    const status = lookupThreshold(
      "lvef_pct",
      [context.sex === "M" ? "male" : "female"],
      scan.lvefPct,
    )?.status;
    if (status && status !== "NORMAL")
      findings.push({
        status,
        text: `LVEF ${scan.lvefPct}% is in the ${status} range.`,
      });
  }

  const baselineMuscle = context.reference.muscleThicknessMm;
  const muscleLossPct =
    scan.muscleThicknessMm !== null && baselineMuscle !== null
      ? Number(((1 - scan.muscleThicknessMm / baselineMuscle) * 100).toFixed(2))
      : null;
  if (muscleLossPct !== null) {
    const status = lookupThreshold(
      "muscle_loss_pct",
      ["any"],
      muscleLossPct,
    )?.status;
    if (status && status !== "NORMAL") {
      findings.push({
        status,
        text: `Muscle thickness is ${muscleLossPct}% below your pre-flight baseline (trend only).`,
      });
    }
  }

  const flagged = findings.filter((f) => f.status !== "NORMAL");
  const notes = findings.filter((f) => f.status === "NORMAL");
  return {
    status: worstStatus(flagged.map((f) => f.status)),
    muscleLossPct,
    explanation:
      [...flagged, ...notes].map((f) => f.text).join(" ") ||
      "All ultrasound measurements are within expected ranges.",
  };
}
