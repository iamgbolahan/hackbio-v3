import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { prisma } from "../src/db/prisma";
import { resetDatabase } from "../src/db/reset";
import type { UploadType } from "../src/modules/ingest/dto/upload.dto";
import { ACCOUNTS, seedProfilesAndAccounts } from "../src/db/seed-accounts";
import { createServices } from "../src/services";

// Loads the synthetic mock pack through the same upload service the API uses: npm run seed [-- --reset]

const MOCK = join(__dirname, "../data/mock");

// Order matters: profiles first, and baselines before the stream so readings are judged against them.
const FILES: [UploadType, string][] = [
  ["profiles", "mock_astronaut_profiles.csv"],
  ["baseline", "mock_baseline_sessions.csv"],
  ["ultrasound", "mock_ultrasound_measurements.csv"],
  ["stream", "mock_realtime_stream.csv"],
];

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { reset: { type: "boolean", default: false } },
  });
  if (values.reset) {
    await resetDatabase(prisma);
    console.log("Database emptied");
  }

  const { csvUpload } = createServices();
  for (const [type, file] of FILES) {
    const started = Date.now();
    const summary = await csvUpload.upload(
      type,
      readFileSync(join(MOCK, file), "utf8"),
    );
    console.log(
      `${type.padEnd(10)} rows=${summary.rows} stored=${summary.stored} duplicates=${summary.duplicates} artifacts=${summary.artifacts} errors=${summary.errorRows.length} (${Date.now() - started} ms)`,
    );
    for (const error of summary.errorRows.slice(0, 5))
      console.log(`  line ${error.line}: ${error.message}`);
  }

  await seedProfilesAndAccounts();
  console.log("\nDemo accounts (crew ID / passcode / Bio-Monitor pairing code):");
  for (const a of ACCOUNTS)
    console.log(`  ${a.loginId.padEnd(6)} ${a.passcode.padEnd(20)} ${a.device ? a.device.pairing : "-"}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
