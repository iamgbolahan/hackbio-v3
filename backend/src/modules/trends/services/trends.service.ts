import type { HealthStatus, PrismaClient } from "generated/prisma/client";
import { NotFoundError } from "../../../middleware/error-handler";
import {
  CHART_RANGE,
  SINGLE_VALUE_METRICS,
  unavailable,
  type SingleValueMetricKey,
} from "../../metrics/metric-catalog";
import { worstStatus } from "../../status/helpers/health-status";
import { lookupThreshold } from "../../status/helpers/threshold-lookup";
import { preFlightReference } from "../../status/services/ultrasound-evaluator";
import type {
  BloodPressureTrend,
  SingleValueTrend,
  TrendPeriod,
  TrendsResponse,
  UltrasoundTrendPoint,
} from "../dto/trends.dto";
import type {
  DailyAverageRow,
  DailyAveragesService,
} from "./daily-averages.service";

const DAY_MS = 86_400_000;
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const round1 = (value: number) => Math.round(value * 10) / 10;

function restingBloodPressureStatus(
  systolic: number,
  diastolic: number,
): HealthStatus {
  // DBP has no low limit in the table, so a value under 60 has no band and counts as NORMAL here.
  return worstStatus([
    lookupThreshold("sbp_mmhg_resting", ["any"], systolic)?.status ?? "NORMAL",
    lookupThreshold("dbp_mmhg_resting", ["any"], diastolic)?.status ?? "NORMAL",
  ]);
}

export class TrendsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly dailyAverages: DailyAveragesService,
  ) {}

  async getTrends(
    astronautId: string,
    period: TrendPeriod,
  ): Promise<TrendsResponse> {
    const astronaut = await this.prisma.astronaut.findUnique({
      where: { id: astronautId },
    });
    if (!astronaut)
      throw new NotFoundError(
        "astronaut_not_found",
        `No astronaut with id ${astronautId}`,
      );

    // The window ends on the latest day with data, not today, so replayed or historical data still charts.
    const asOf = await this.dailyAverages.latestDay(astronautId);
    const rows = asOf
      ? await this.dailyAverages.between(
          astronautId,
          new Date(asOf.getTime() - (period - 1) * DAY_MS),
          asOf,
        )
      : [];

    return {
      period,
      asOf: asOf ? isoDate(asOf) : null,
      metrics: {
        heartRate: unavailable,
        skinTemperature: unavailable,
        respiratoryRate: this.singleValueTrend("respiratoryRate", rows),
        oxygenSaturation: this.singleValueTrend("oxygenSaturation", rows),
        bloodGlucose: this.singleValueTrend("bloodGlucose", rows),
        bloodPressure: this.bloodPressureTrend(rows),
      },
      ultrasound: await this.ultrasoundTrend(astronautId),
    };
  }

  private singleValueTrend(
    metric: SingleValueMetricKey,
    rows: readonly DailyAverageRow[],
  ): SingleValueTrend {
    const { parameter, unit } = SINGLE_VALUE_METRICS[metric];
    return {
      status: "available",
      unit,
      ...CHART_RANGE[metric],
      days: rows
        .filter((row) => row.parameter === parameter)
        .map((row) => ({
          date: isoDate(row.date),
          missionDay: row.missionDay,
          value: round1(row.average),
          samples: row.samples,
        })),
    };
  }

  private bloodPressureTrend(
    rows: readonly DailyAverageRow[],
  ): BloodPressureTrend {
    const diastolicByDate = new Map(
      rows
        .filter((row) => row.parameter === "dbp_mmhg")
        .map((row) => [isoDate(row.date), row.average]),
    );
    const days = rows
      .filter((row) => row.parameter === "sbp_mmhg")
      .flatMap((row) => {
        const diastolic = diastolicByDate.get(isoDate(row.date));
        if (diastolic === undefined) return [];
        return [
          {
            date: isoDate(row.date),
            missionDay: row.missionDay,
            systolic: round1(row.average),
            diastolic: round1(diastolic),
            status: restingBloodPressureStatus(row.average, diastolic),
          },
        ];
      });
    return {
      status: "available",
      unit: "mmHg",
      ...CHART_RANGE.bloodPressure,
      days,
    };
  }

  private async ultrasoundTrend(
    astronautId: string,
  ): Promise<UltrasoundTrendPoint[]> {
    const scans = await this.prisma.ultrasoundScan.findMany({
      where: { astronautId },
      orderBy: { timestampUtc: "asc" },
    });
    const onsdBaselineMm = preFlightReference(
      scans.filter((scan) => !scan.inFlight),
    ).onsdMm;
    return scans.map((scan) => ({
      timestampUtc: scan.timestampUtc.toISOString(),
      missionDay: scan.missionDay,
      inFlight: scan.inFlight,
      status: scan.status,
      ijvAreaMm2: scan.ijvAreaMm2,
      ijvFlowGrade: scan.ijvFlowGrade,
      onsdMm: scan.onsdMm,
      onsdBaselineMm,
      cimtMm: scan.cimtMm,
      lvefPct: scan.lvefPct,
      muscleThicknessMm: scan.muscleThicknessMm,
      muscleLossPct: scan.muscleLossPct,
    }));
  }
}
