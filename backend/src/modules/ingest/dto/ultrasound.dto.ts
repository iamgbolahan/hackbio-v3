import { z } from "zod";

// Plausible-range bounds for manually entered scan values; outside these the form entry is rejected.
const measurement = (min: number, max: number) =>
  z
    .number()
    .min(min)
    .max(max)
    .nullish()
    .transform((value) => value ?? null);

export const ultrasoundRecordSchema = z
  .object({
    timestamp_utc: z
      .string()
      .datetime({ offset: true })
      .transform((value) => new Date(value)),
    astronaut_id: z.string().trim().min(1),
    source: z.enum(["bio_monitor", "glucose_sensor", "manual_entry", "mock"]),
    in_flight: z.boolean(),
    condition: z.enum(["normal_earth", "spaceflight"]),
    mission_day: z
      .number()
      .int()
      .nullish()
      .transform((value) => value ?? null),
    ijv_area_mm2: measurement(0, 250),
    ijv_flow_grade: z
      .number()
      .int()
      .min(1)
      .max(4)
      .nullish()
      .transform((value) => value ?? null),
    onsd_mm: measurement(2, 12),
    cimt_mm: measurement(0.1, 3),
    lvef_pct: measurement(5, 95),
    muscle_thickness_mm: measurement(1, 150),
    scenario_tag: z
      .string()
      .nullish()
      .transform((value) => value || null),
  })
  .refine(
    (r) =>
      [
        r.ijv_area_mm2,
        r.ijv_flow_grade,
        r.onsd_mm,
        r.cimt_mm,
        r.lvef_pct,
        r.muscle_thickness_mm,
      ].some((value) => value !== null),
    { message: "at least one measurement is required", path: ["onsd_mm"] },
  )
  .transform((r) => ({
    timestampUtc: r.timestamp_utc,
    astronautId: r.astronaut_id,
    source: r.source,
    inFlight: r.in_flight,
    condition: r.condition,
    missionDay: r.mission_day,
    ijvAreaMm2: r.ijv_area_mm2,
    ijvFlowGrade: r.ijv_flow_grade,
    onsdMm: r.onsd_mm,
    cimtMm: r.cimt_mm,
    lvefPct: r.lvef_pct,
    muscleThicknessMm: r.muscle_thickness_mm,
    scenarioTag: r.scenario_tag,
  }));

export type UltrasoundRecord = z.output<typeof ultrasoundRecordSchema>;
