import { parse } from "csv-parse/sync";
import { BadRequestError } from "../../../middleware/error-handler";

const BOOLEAN_COLUMNS = new Set(["in_flight", "fasting", "valid"]);
const NUMBER_COLUMNS = new Set([
  "resp_rate_bpm",
  "spo2_pct",
  "sbp_mmhg",
  "dbp_mmhg",
  "glucose_mgdl",
  "mission_day",
  "duration_min",
  "n_bp_readings",
  "launch_day",
  "ijv_area_mm2",
  "ijv_flow_grade",
  "onsd_mm",
  "cimt_mm",
  "lvef_pct",
  "muscle_thickness_mm",
]);

export type CsvValue = string | number | boolean | null;

export interface CsvRow {
  // 1-based line in the file, counting the header, so errors point at what the operator sees.
  line: number;
  values: Record<string, CsvValue>;
}

// Empty cells mean "not measured"; anything that fails to cast stays a string so the row schema reports it.
function castCell(column: string, raw: string): CsvValue {
  if (raw === "") return null;
  if (BOOLEAN_COLUMNS.has(column) && (raw === "true" || raw === "false"))
    return raw === "true";
  if (NUMBER_COLUMNS.has(column) && Number.isFinite(Number(raw)))
    return Number(raw);
  return raw;
}

export function parseCsv(
  text: string,
  requiredColumns: readonly string[],
): CsvRow[] {
  let records: Record<string, string>[];
  try {
    records = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (error) {
    throw new BadRequestError(
      "invalid_csv",
      error instanceof Error ? error.message : "Could not parse CSV",
    );
  }

  const header = Object.keys(records[0] ?? {});
  const missing = requiredColumns.filter((column) => !header.includes(column));
  if (records.length > 0 && missing.length > 0) {
    throw new BadRequestError(
      "missing_columns",
      `Missing required columns: ${missing.join(", ")}`,
    );
  }

  return records.map((record, index) => ({
    line: index + 2,
    values: Object.fromEntries(
      Object.entries(record).map(([column, raw]) => [
        column,
        castCell(column, raw),
      ]),
    ),
  }));
}
