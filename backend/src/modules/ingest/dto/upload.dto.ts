import { z } from "zod";

export const uploadQuerySchema = z.object({
  type: z.enum(["profiles", "baseline", "ultrasound", "stream"]),
});

export type UploadType = z.output<typeof uploadQuerySchema>["type"];

export const REQUIRED_COLUMNS: Record<UploadType, readonly string[]> = {
  profiles: ["astronaut_id", "sex", "launch_day"],
  baseline: [
    "astronaut_id",
    "session_id",
    "session_start_utc",
    "test_condition",
    "context",
    "duration_min",
    "valid",
  ],
  ultrasound: [
    "timestamp_utc",
    "astronaut_id",
    "source",
    "in_flight",
    "condition",
  ],
  stream: [
    "timestamp_utc",
    "astronaut_id",
    "session_id",
    "source",
    "in_flight",
    "activity_level",
  ],
};

export const profileRowSchema = z
  .object({
    astronaut_id: z.string().trim().min(1),
    sex: z.enum(["M", "F"]),
    launch_day: z.number().int().positive(),
  })
  .transform((r) => ({
    id: r.astronaut_id,
    sex: r.sex,
    launchDay: r.launch_day,
  }));

export type ProfileRow = z.output<typeof profileRowSchema>;

const sessionValue = z
  .number()
  .finite()
  .nullish()
  .transform((value) => value ?? null);

export const baselineSessionRowSchema = z
  .object({
    astronaut_id: z.string().trim().min(1),
    session_id: z.string().trim().min(1),
    session_start_utc: z
      .string()
      .datetime({ offset: true })
      .transform((value) => new Date(value)),
    test_condition: z.enum([
      "normal_earth",
      "head_down_tilt",
      "dry_immersion",
      "raised_co2",
      "reduced_pressure",
    ]),
    context: z.string().trim().min(1),
    duration_min: z.number().int().positive(),
    resp_rate_bpm: sessionValue,
    spo2_pct: sessionValue,
    sbp_mmhg: sessionValue,
    dbp_mmhg: sessionValue,
    n_bp_readings: z
      .number()
      .int()
      .nullish()
      .transform((value) => value ?? null),
    valid: z.boolean(),
    invalid_reason: z
      .string()
      .nullish()
      .transform((value) => value || null),
  })
  .transform((r) => ({
    sessionId: r.session_id,
    astronautId: r.astronaut_id,
    sessionStartUtc: r.session_start_utc,
    testCondition: r.test_condition,
    context: r.context,
    durationMin: r.duration_min,
    respRateBpm: r.resp_rate_bpm,
    spo2Pct: r.spo2_pct,
    sbpMmhg: r.sbp_mmhg,
    dbpMmhg: r.dbp_mmhg,
    nBpReadings: r.n_bp_readings,
    valid: r.valid,
    invalidReason: r.invalid_reason,
  }));

export type BaselineSessionRow = z.output<typeof baselineSessionRowSchema>;
