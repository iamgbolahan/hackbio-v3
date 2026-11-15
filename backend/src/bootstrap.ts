import { Pool } from "pg";
import { env } from "./config/env";
import { prisma } from "./db/prisma";
import { seedProfilesAndAccounts } from "./db/seed-accounts";
import { MIGRATIONS, SEED_CSV } from "./serverless/embedded";
import type { Services } from "./services";
import { createServices } from "./services";

// Runs before the server on hosts with no shell (for example Render's free plan).
// Safe to repeat on every start: it only creates what is missing and never resets a changed passcode.

const MARKS: Record<string, string> = {
  "20261114191956_init": "astronauts",
  "20261115120000_auth": "users",
};

async function migrate(): Promise<void> {
  const url = new URL(env.DATABASE_URL);
  url.searchParams.delete("channel_binding");
  const pool = new Pool({ connectionString: url.toString(), max: 1 });
  try {
    for (const migration of MIGRATIONS) {
      const mark = MARKS[migration.name];
      const exists =
        mark &&
        (await pool.query("select to_regclass($1) as t", [`public.${mark}`])).rows[0].t !== null;
      if (exists) continue;
      await pool.query(migration.sql);
      console.log(`bootstrap: applied migration ${migration.name}`);
    }
  } finally {
    await pool.end();
  }
}

async function seedIfEmpty(services: Services): Promise<void> {
  if ((await prisma.astronaut.count()) === 0) {
    for (const type of ["profiles", "baseline", "ultrasound"] as const) {
      const summary = await services.csvUpload.upload(type, SEED_CSV[type]);
      console.log(`bootstrap: ${type} rows=${summary.rows} stored=${summary.stored}`);
    }
  }
  if ((await prisma.user.count()) === 0) {
    await seedProfilesAndAccounts();
    console.log("bootstrap: demo accounts created");
  }
}

export async function bootstrap(): Promise<void> {
  await migrate();
  await seedIfEmpty(createServices());
}

// Past mission days for any astronaut with no readings yet. Runs in the background after the server is listening.
export async function backfillMissingHistory(services: Services): Promise<void> {
  const astronauts = await prisma.astronaut.findMany({ select: { id: true } });
  for (const { id } of astronauts) {
    if ((await prisma.reading.count({ where: { astronautId: id } })) > 0) continue;
    const started = Date.now();
    const result = await services.simulator.backfillHistory(id);
    console.log(`bootstrap: history for ${id}: ${result.stored} readings in ${Date.now() - started} ms`);
  }
}
