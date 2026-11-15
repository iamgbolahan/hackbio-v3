import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { REQUIRED_COLUMNS } from "../src/modules/ingest/dto/upload.dto";
import { parseCsv, type CsvValue } from "../src/modules/ingest/helpers/csv";

// Replays the mock stream to POST /api/readings one record at a time, like the Bio-Monitor would (options in README).

const STREAM = join(__dirname, "../data/mock/mock_realtime_stream.csv");

const { values: options } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:3000/api/readings" },
    astronaut: { type: "string" },
    "from-day": { type: "string" },
    limit: { type: "string" },
    rate: { type: "string", default: "1" },
    "shift-to-now": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

const rate = Number(options.rate);
const fromDay = options["from-day"] ? Number(options["from-day"]) : null;
const limit = options.limit ? Number(options.limit) : Infinity;
if (
  !(rate > 0) ||
  (fromDay !== null && !Number.isInteger(fromDay)) ||
  !(limit > 0)
) {
  console.error(
    "--rate and --limit must be positive numbers, --from-day an integer",
  );
  process.exit(1);
}

type StreamRecord = Record<string, CsvValue> & {
  timestamp_utc: string;
  astronaut_id: string;
};

function loadRecords(): StreamRecord[] {
  return parseCsv(readFileSync(STREAM, "utf8"), REQUIRED_COLUMNS.stream)
    .map((row) => row.values as StreamRecord)
    .filter((r) => !options.astronaut || r.astronaut_id === options.astronaut)
    .filter((r) => fromDay === null || Number(r.mission_day) >= fromDay)
    .sort((a, b) => a.timestamp_utc.localeCompare(b.timestamp_utc))
    .slice(0, limit);
}

async function main(): Promise<void> {
  const records = loadRecords();
  const first = records[0];
  if (!first) {
    console.log("No records match the filters");
    return;
  }
  // Shifting keeps the 5-minute spacing but moves the first record to now, so the dashboard shows it as live.
  const offsetMs = options["shift-to-now"]
    ? Date.now() - Date.parse(first.timestamp_utc)
    : 0;
  console.log(
    `Replaying ${records.length} records to ${options.url} at ${rate}/s`,
  );

  for (const record of records) {
    const body = {
      ...record,
      timestamp_utc: new Date(
        Date.parse(record.timestamp_utc) + offsetMs,
      ).toISOString(),
    };
    if (options["dry-run"]) {
      console.log(JSON.stringify(body));
      continue;
    }
    try {
      const response = await fetch(options.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as {
        status?: string | null;
        explanation?: string;
        error?: string;
      };
      const label = response.ok
        ? (result.status ?? "ARTIFACT")
        : `HTTP ${response.status} ${result.error}`;
      if (label !== "NORMAL")
        console.log(
          `${body.timestamp_utc} ${record.astronaut_id} ${label} ${result.explanation ?? ""}`,
        );
    } catch (error) {
      // Keep going like a sensor would; the next record may get through.
      console.warn(
        `${body.timestamp_utc} ${record.astronaut_id} send failed: ${error instanceof Error ? error.message : error}`,
      );
    }
    await sleep(1000 / rate);
  }
}

void main();
