import { existsSync } from "node:fs";
import { z } from "zod";

if (existsSync(".env")) process.loadEnvFile(".env");

const optionalMinutes = z
  .string()
  .optional()
  .transform((value) => (value ? Number(value) : null))
  .pipe(z.number().int().positive().nullable());

const flag = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value === undefined ? fallback : ["1", "true", "yes"].includes(value),
    );

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  PERSISTENCE_RESP_RATE_MIN: optionalMinutes,
  PERSISTENCE_SPO2_MIN: optionalMinutes,
  PERSISTENCE_SBP_MIN: optionalMinutes,
  PERSISTENCE_GLUCOSE_MIN: optionalMinutes,
  BASELINE_Z_LIMIT: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : null))
    .pipe(z.number().positive().nullable()),
  GAP_MINUTES: z.coerce.number().int().positive().default(10),
  CONNECTED_WITHIN_MIN: z.coerce.number().int().positive().default(15),

  // Sign-in and sessions.
  SESSION_TTL_HOURS: z.coerce.number().positive().default(2),
  SESSION_IDLE_MIN: z.coerce.number().positive().default(15),
  LOCKOUT_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOCKOUT_MIN: z.coerce.number().positive().default(15),
  COOKIE_SECURE: flag(false),
  // WebAuthn (fingerprint / face / security key). The origin must match the address in the browser.
  WEBAUTHN_RP_ID: z.string().default("localhost"),
  WEBAUTHN_RP_NAME: z.string().default("AstroVital"),
  WEBAUTHN_ORIGIN: z.string().default("http://localhost:3000"),
  // Shared secret a real Bio-Monitor gateway sends as X-Device-Key when posting readings.
  DEVICE_API_KEY: z.string().optional(),

  // Simulated Bio-Monitor: the "mock source" adapter from the proposal, streaming into the same ingest path.
  SIM_ENABLED: flag(true),
  SIM_DEMO_EPISODES: flag(false),
  // Serverless hosts cannot keep a timer running: generate the readings due whenever a data page asks.
  SIM_LAZY: flag(false),
  // On first start, fill the mission days that have already passed (hosts with no shell, e.g. Render).
  BACKFILL_ON_START: flag(false),
  // Serverless hosts with no shell: run migrate + seed + history once on the first request, then switch this off.
  AUTO_SETUP: flag(false),
  // Folder holding the four app pages when they are kept out of the public folder (Vercel). Falls back to FRONTEND_DIR.
  PROTECTED_PAGES_DIR: z.string().optional(),
  SIM_MAX_BACKFILL_HOURS: z.coerce.number().positive().default(336),
  // Enables the one-time /api/setup/* endpoints (migrate, seed, history). Leave unset to switch them off.
  SETUP_TOKEN: z.string().min(16).optional(),
  SIM_INTERVAL_SEC: z.coerce.number().int().positive().default(5),
  MISSION_START_DATE: z.string().default("2026-10-08"),

  // Folder with the web pages; served from the same address as the API so cookies need no CORS.
  FRONTEND_DIR: z.string().default("../frontend"),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
