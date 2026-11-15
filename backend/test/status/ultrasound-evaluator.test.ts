import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateUltrasound,
  preFlightReference,
  type UltrasoundMeasurements,
} from "../../src/modules/status/services/ultrasound-evaluator";

interface MockScan {
  timestamp_utc: string;
  astronaut_id: "A01" | "A02";
  in_flight: boolean;
  mission_day: number | null;
  ijv_flow_grade: number;
  onsd_mm: number;
  cimt_mm: number;
  lvef_pct: number;
  muscle_thickness_mm: number;
  scenario_tag: string;
}

const scans = JSON.parse(
  readFileSync(
    join(__dirname, "../../data/mock/json/ultrasound_measurements.json"),
    "utf8",
  ),
) as MockScan[];
const SEX = { A01: "M", A02: "F" } as const;

const measurements = (s: MockScan): UltrasoundMeasurements => ({
  inFlight: s.in_flight,
  ijvFlowGrade: s.ijv_flow_grade,
  onsdMm: s.onsd_mm,
  cimtMm: s.cimt_mm,
  lvefPct: s.lvef_pct,
  muscleThicknessMm: s.muscle_thickness_mm,
});

function evaluate(scan: MockScan) {
  const ground = scans
    .filter((s) => s.astronaut_id === scan.astronaut_id && !s.in_flight)
    .map(measurements);
  return evaluateUltrasound(measurements(scan), {
    sex: SEX[scan.astronaut_id],
    reference: preFlightReference(ground),
  });
}

describe("evaluateUltrasound against the mock scans", () => {
  for (const scan of scans) {
    const label = `${scan.astronaut_id} ${scan.in_flight ? `day ${scan.mission_day}` : scan.timestamp_utc.slice(0, 10)}`;
    it(`${label} is ${scan.scenario_tag ? "WATCH" : "NORMAL"}`, () => {
      expect(evaluate(scan).status).toBe(
        scan.scenario_tag ? "WATCH" : "NORMAL",
      );
    });
  }

  it("explains the A01 day-30 scan with both IJV grade and ONSD rise", () => {
    const day30 = scans.find(
      (s) => s.astronaut_id === "A01" && s.mission_day === 30,
    ) as MockScan;
    const result = evaluate(day30);
    expect(result.explanation).toContain("IJV flow grade 3");
    expect(result.explanation).toContain(
      "ONSD 6.95 mm exceeds your pre-flight baseline 5.20 + 0.91 mm",
    );
  });

  it("derives muscle loss from the pre-flight mean", () => {
    const day30 = scans.find(
      (s) => s.astronaut_id === "A01" && s.mission_day === 30,
    ) as MockScan;
    // Pre-flight mean (21.8 + 22.1 + 22.0) / 3 = 21.967; 21.32 is 2.94% below it.
    expect(evaluate(day30).muscleLossPct).toBeCloseTo(2.94, 2);
  });

  it("flags ONSD at or above 7.2 mm as ATTENTION on the ground or in flight", () => {
    const reference = { onsdMm: 5.2, muscleThicknessMm: null };
    const base = {
      ijvFlowGrade: null,
      cimtMm: null,
      lvefPct: null,
      muscleThicknessMm: null,
    };
    expect(
      evaluateUltrasound(
        { ...base, inFlight: true, onsdMm: 7.3 },
        { sex: "M", reference },
      ).status,
    ).toBe("ATTENTION");
    expect(
      evaluateUltrasound(
        { ...base, inFlight: false, onsdMm: 7.2 },
        { sex: "M", reference },
      ).status,
    ).toBe("ATTENTION");
  });
});
