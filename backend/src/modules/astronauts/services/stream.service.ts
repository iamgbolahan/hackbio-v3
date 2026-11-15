import type { PrismaClient } from "generated/prisma/client";
import { NotFoundError } from "../../../middleware/error-handler";

export interface StreamResponse {
  astronautId: string;
  total: number;
  readings: {
    timestamp: string;
    respiratoryRate: number | null;
    oxygenSaturation: number | null;
    systolic: number | null;
    diastolic: number | null;
    bloodGlucose: number | null;
    heartRate: number | null;
    skinTemperature: number | null;
    activityLevel: string;
    signalQuality: string;
    status: string;
  }[];
}

// The latest raw readings, newest last, for the live table and the little charts on the overview.
export class StreamService {
  constructor(private readonly prisma: PrismaClient) {}

  async recent(astronautId: string, limit: number): Promise<StreamResponse> {
    const astronaut = await this.prisma.astronaut.findUnique({ where: { id: astronautId } });
    if (!astronaut)
      throw new NotFoundError("astronaut_not_found", `No astronaut with id ${astronautId}`);
    const [rows, total] = await Promise.all([
      this.prisma.reading.findMany({
        where: { astronautId },
        orderBy: { timestampUtc: "desc" },
        take: limit,
      }),
      this.prisma.reading.count({ where: { astronautId } }),
    ]);
    return {
      astronautId,
      total,
      readings: rows.reverse().map((row) => ({
        timestamp: row.timestampUtc.toISOString(),
        respiratoryRate: row.respRateBpm,
        oxygenSaturation: row.spo2Pct,
        systolic: row.sbpMmhg,
        diastolic: row.dbpMmhg,
        bloodGlucose: row.glucoseMgdl,
        heartRate: row.hrBpm,
        skinTemperature: row.skinTempC,
        activityLevel: row.activityLevel,
        signalQuality: row.signalQuality,
        status: row.status ?? "IGNORED",
      })),
    };
  }
}
