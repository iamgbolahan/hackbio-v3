import type { PrismaClient } from "generated/prisma/client";
import { ZodError, type ZodType, type ZodTypeDef } from "zod";
import { NotFoundError } from "../../../middleware/error-handler";
import type { BaselineStatsService } from "../../baselines/services/baseline-stats.service";
import { readingRecordSchema, type ReadingRecord } from "../dto/reading.dto";
import { ultrasoundRecordSchema } from "../dto/ultrasound.dto";
import {
  baselineSessionRowSchema,
  profileRowSchema,
  REQUIRED_COLUMNS,
  type BaselineSessionRow,
  type ProfileRow,
  type UploadType,
} from "../dto/upload.dto";
import { parseCsv, type CsvRow } from "../helpers/csv";
import type { ReadingIngestService } from "./reading-ingest.service";
import type { UltrasoundIngestService } from "./ultrasound-ingest.service";

export interface RowError {
  line: number;
  message: string;
}

export interface UploadSummary {
  type: UploadType;
  rows: number;
  stored: number;
  duplicates: number;
  artifacts: number;
  errorRows: RowError[];
}

interface ValidRow<T> {
  line: number;
  value: T;
}

function validateRows<T>(
  rows: readonly CsvRow[],
  schema: ZodType<T, ZodTypeDef, unknown>,
) {
  const valid: ValidRow<T>[] = [];
  const errors: RowError[] = [];
  for (const row of rows) {
    const result = schema.safeParse(row.values);
    if (result.success) valid.push({ line: row.line, value: result.data });
    else
      errors.push({ line: row.line, message: describeZodError(result.error) });
  }
  return { valid, errors };
}

function describeZodError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "row"}: ${issue.message}`)
    .join("; ");
}

const unknownAstronaut = (line: number, astronautId: string): RowError => ({
  line,
  message: `astronaut_id: no astronaut with id ${astronautId} (upload profiles first)`,
});

// Turns an uploaded CSV file into stored records, through the same checks as the JSON routes.
export class CsvUploadService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly readingIngest: ReadingIngestService,
    private readonly ultrasoundIngest: UltrasoundIngestService,
    private readonly baselineStats: BaselineStatsService,
  ) {}

  async upload(type: UploadType, csv: string): Promise<UploadSummary> {
    const rows = parseCsv(csv, REQUIRED_COLUMNS[type]);
    const summary: UploadSummary = {
      type,
      rows: rows.length,
      stored: 0,
      duplicates: 0,
      artifacts: 0,
      errorRows: [],
    };
    switch (type) {
      case "profiles":
        return this.uploadProfiles(rows, summary);
      case "baseline":
        return this.uploadBaselineSessions(rows, summary);
      case "ultrasound":
        return this.uploadUltrasound(rows, summary);
      case "stream":
        return this.uploadStream(rows, summary);
    }
  }

  private async uploadProfiles(
    rows: CsvRow[],
    summary: UploadSummary,
  ): Promise<UploadSummary> {
    const { valid, errors } = validateRows<ProfileRow>(rows, profileRowSchema);
    for (const { value } of valid) {
      const crewNumber = value.id.replace(/\D/g, "") || value.id;
      // Display fields are only set on creation so a re-upload keeps any names set since.
      await this.prisma.astronaut.upsert({
        where: { id: value.id },
        create: {
          ...value,
          displayName: `Crew Member ${crewNumber}`,
          crewNumber,
        },
        update: { sex: value.sex, launchDay: value.launchDay },
      });
    }
    return { ...summary, stored: valid.length, errorRows: errors };
  }

  private async uploadBaselineSessions(
    rows: CsvRow[],
    summary: UploadSummary,
  ): Promise<UploadSummary> {
    const { valid, errors } = validateRows<BaselineSessionRow>(
      rows,
      baselineSessionRowSchema,
    );
    const known = await this.knownAstronauts(
      valid.map((row) => row.value.astronautId),
    );
    const accepted = valid.filter((row) => known.has(row.value.astronautId));
    const rejected = valid
      .filter((row) => !known.has(row.value.astronautId))
      .map((row) => unknownAstronaut(row.line, row.value.astronautId));

    await this.prisma.$transaction(
      accepted.map(({ value }) =>
        this.prisma.baselineSession.upsert({
          where: { sessionId: value.sessionId },
          create: value,
          update: value,
        }),
      ),
    );
    for (const astronautId of new Set(
      accepted.map((row) => row.value.astronautId),
    )) {
      await this.baselineStats.recompute(astronautId);
    }
    return {
      ...summary,
      stored: accepted.length,
      errorRows: [...errors, ...rejected],
    };
  }

  private async uploadUltrasound(
    rows: CsvRow[],
    summary: UploadSummary,
  ): Promise<UploadSummary> {
    const { valid, errors } = validateRows(rows, ultrasoundRecordSchema);
    // Ground scans first: they are the pre-flight reference that in-flight scans are judged against.
    const ordered = [...valid].sort(
      (a, b) => a.value.timestampUtc.getTime() - b.value.timestampUtc.getTime(),
    );

    let stored = 0;
    let duplicates = 0;
    for (const { line, value } of ordered) {
      try {
        const outcome = await this.ultrasoundIngest.ingest(value);
        if (outcome.stored) stored++;
        else duplicates++;
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
        errors.push(unknownAstronaut(line, value.astronautId));
      }
    }
    return { ...summary, stored, duplicates, errorRows: errors };
  }

  private async uploadStream(
    rows: CsvRow[],
    summary: UploadSummary,
  ): Promise<UploadSummary> {
    const { valid, errors } = validateRows<ReadingRecord>(
      rows,
      readingRecordSchema,
    );
    const known = await this.knownAstronauts(
      valid.map((row) => row.value.astronautId),
    );
    const accepted = valid
      .filter((row) => known.has(row.value.astronautId))
      .map((row) => row.value);
    const rejected = valid
      .filter((row) => !known.has(row.value.astronautId))
      .map((row) => unknownAstronaut(row.line, row.value.astronautId));

    const outcomes = await this.readingIngest.ingestBatch(accepted);
    return {
      ...summary,
      stored: outcomes.filter((o) => o.stored).length,
      duplicates: outcomes.filter((o) => !o.stored).length,
      artifacts: outcomes.filter(
        (o) => o.stored && o.signalQuality === "ARTIFACT",
      ).length,
      errorRows: [...errors, ...rejected].sort((a, b) => a.line - b.line),
    };
  }

  private async knownAstronauts(ids: readonly string[]): Promise<Set<string>> {
    const astronauts = await this.prisma.astronaut.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true },
    });
    return new Set(astronauts.map((a) => a.id));
  }
}
