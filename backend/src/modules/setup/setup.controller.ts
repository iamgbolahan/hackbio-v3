import { timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { Pool } from "pg";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { seedProfilesAndAccounts } from "../../db/seed-accounts";
import { asyncHandler } from "../../middleware/async-handler";
import { ForbiddenError, NotFoundError } from "../../middleware/error-handler";
import { MIGRATIONS, SEED_CSV } from "../../serverless/embedded";
import type { Services } from "../../services";

// One-time database preparation for hosts where nothing can be run by hand (for example Vercel + Neon).
// Off unless SETUP_TOKEN is set; every call must send it as the X-Setup-Token header.
const guard: RequestHandler = (req, _res, next) => {
  const expected = env.SETUP_TOKEN;
  if (!expected) return next(new NotFoundError("not_found", "Not found"));
  const given = Buffer.from(String(req.get("x-setup-token") ?? ""));
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted))
    return next(new ForbiddenError("bad_setup_token", "Setup token not accepted."));
  next();
};

export function setupRouter(services: Services): Router {
  const router = Router();
  router.use("/setup", guard);

  router.post(
    "/setup/migrate",
    asyncHandler(async (_req, res) => {
      const url = new URL(env.DATABASE_URL);
      url.searchParams.delete("channel_binding");
      const pool = new Pool({ connectionString: url.toString(), max: 1 });
      const applied: string[] = [];
      try {
        const have = async (table: string) =>
          (await pool.query("select to_regclass($1) as t", [`public.${table}`])).rows[0].t !== null;
        // Each migration is skipped when the table it creates is already there, so this is safe to repeat.
        const marks: Record<string, string> = {
          "20261114191956_init": "astronauts",
          "20261115120000_auth": "users",
        };
        for (const migration of MIGRATIONS) {
          const mark = marks[migration.name];
          if (mark && (await have(mark))) continue;
          await pool.query(migration.sql);
          applied.push(migration.name);
        }
      } finally {
        await pool.end();
      }
      res.json({ ok: true, applied });
    }),
  );

  router.post(
    "/setup/seed",
    asyncHandler(async (_req, res) => {
      const results: Record<string, unknown> = {};
      for (const type of ["profiles", "baseline", "ultrasound"] as const) {
        const summary = await services.csvUpload.upload(type, SEED_CSV[type]);
        results[type] = { rows: summary.rows, stored: summary.stored, duplicates: summary.duplicates, errors: summary.errorRows.length };
      }
      await seedProfilesAndAccounts();
      res.json({ ok: true, results, astronauts: await prisma.astronaut.count(), users: await prisma.user.count() });
    }),
  );

  router.post(
    "/setup/history/:astronautId",
    asyncHandler(async (req, res) => {
      const started = Date.now();
      const result = await services.simulator.backfillHistory(req.params.astronautId as string);
      res.json({ ok: true, ...result, ms: Date.now() - started });
    }),
  );

  return router;
}
