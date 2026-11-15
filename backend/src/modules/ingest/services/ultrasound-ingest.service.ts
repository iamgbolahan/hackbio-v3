import type { HealthStatus, PrismaClient } from "generated/prisma/client";
import { NotFoundError } from "../../../middleware/error-handler";
import {
  evaluateUltrasound,
  preFlightReference,
} from "../../status/services/ultrasound-evaluator";
import type { UltrasoundRecord } from "../dto/ultrasound.dto";

export type UltrasoundIngestOutcome =
  | {
      stored: true;
      status: HealthStatus;
      muscleLossPct: number | null;
      explanation: string;
    }
  | { stored: false; duplicate: true };

export class UltrasoundIngestService {
  constructor(private readonly prisma: PrismaClient) {}

  // Ground scans must be stored before in-flight ones: they form the pre-flight reference.
  async ingest(record: UltrasoundRecord): Promise<UltrasoundIngestOutcome> {
    const astronaut = await this.prisma.astronaut.findUnique({
      where: { id: record.astronautId },
    });
    if (!astronaut)
      throw new NotFoundError(
        "astronaut_not_found",
        `No astronaut with id ${record.astronautId}`,
      );

    const existing = await this.prisma.ultrasoundScan.findUnique({
      where: {
        astronautId_timestampUtc: {
          astronautId: record.astronautId,
          timestampUtc: record.timestampUtc,
        },
      },
      select: { id: true },
    });
    if (existing) return { stored: false, duplicate: true };

    const groundScans = await this.prisma.ultrasoundScan.findMany({
      where: { astronautId: record.astronautId, inFlight: false },
    });
    const evaluation = evaluateUltrasound(record, {
      sex: astronaut.sex,
      reference: preFlightReference(
        record.inFlight ? groundScans : [...groundScans, record],
      ),
    });

    await this.prisma.ultrasoundScan.create({
      data: {
        ...record,
        muscleLossPct: evaluation.muscleLossPct,
        status: evaluation.status,
        explanation: evaluation.explanation,
      },
    });
    return { stored: true, ...evaluation };
  }
}
