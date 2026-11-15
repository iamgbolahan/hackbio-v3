import { z } from "zod";

const measurement = z
  .number()
  .finite()
  .nullish()
  .transform((value) => value ?? null);

// The proposal's common record: every source (Bio-Monitor, glucose sensor, mock replay, CSV) sends this shape.
export const readingRecordSchema = z
  .object({
    timestamp_utc: z
      .string()
      .datetime({ offset: true })
      .transform((value) => new Date(value)),
    astronaut_id: z.string().trim().min(1),
    session_id: z.string().trim().min(1),
    source: z.enum(["bio_monitor", "glucose_sensor", "manual_entry", "mock"]),
    in_flight: z.boolean(),
    activity_level: z.enum(["low", "moderate", "high"]),
    resp_rate_bpm: measurement,
    spo2_pct: measurement,
    sbp_mmhg: measurement,
    dbp_mmhg: measurement,
    glucose_mgdl: measurement,
    fasting: z
      .boolean()
      .nullish()
      .transform((value) => value ?? null),
    signal_quality: z.enum(["OK", "LOW", "ARTIFACT"]).default("OK"),
    mission_day: z
      .number()
      .int()
      .nullish()
      .transform((value) => value ?? null),
    scenario_tag: z
      .string()
      .nullish()
      .transform((value) => value || null),
  })
  .refine(
    (r) =>
      [
        r.resp_rate_bpm,
        r.spo2_pct,
        r.sbp_mmhg,
        r.dbp_mmhg,
        r.glucose_mgdl,
      ].some((value) => value !== null),
    {
      message: "at least one measurement is required",
      path: ["resp_rate_bpm"],
    },
  )
  .transform((r) => ({
    timestampUtc: r.timestamp_utc,
    astronautId: r.astronaut_id,
    sessionId: r.session_id,
    source: r.source,
    inFlight: r.in_flight,
    activityLevel: r.activity_level,
    respRateBpm: r.resp_rate_bpm,
    spo2Pct: r.spo2_pct,
    sbpMmhg: r.sbp_mmhg,
    dbpMmhg: r.dbp_mmhg,
    glucoseMgdl: r.glucose_mgdl,
    fasting: r.fasting,
    signalQuality: r.signal_quality,
    missionDay: r.mission_day,
    scenarioTag: r.scenario_tag,
  }));

export type ReadingRecord = z.output<typeof readingRecordSchema>;
