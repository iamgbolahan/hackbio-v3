import type {
  BaselineParameter,
  HealthStatus,
  PrismaClient,
  Reading,
} from "generated/prisma/client";
import { NotFoundError } from "../../../middleware/error-handler";
import { isBaselineApproved } from "../../baselines/helpers/baseline-approval";
import type { BaselineStatsService } from "../../baselines/services/baseline-stats.service";
import { unavailable } from "../../metrics/metric-catalog";
import { selectBaselineReference } from "../../status/helpers/baseline-reference";
import { worstStatus } from "../../status/helpers/health-status";
import { parseStoredEvaluation } from "../../status/helpers/stored-evaluation";
import type {
  BaselineStatSummary,
  ParameterEvaluations,
} from "../../status/types";
import type {
  OverviewReadings,
  OverviewResponse,
  SingleReadingView,
} from "../dto/overview.dto";
import { vitalReference } from "../../simulator/generator";
import type { MonitoringSessionService } from "./monitoring-session.service";

const ADVICE: Record<HealthStatus, string> = {
  NORMAL:
    "Everything is inside its expected range. Carry on with the planned schedule and keep the Bio-Monitor worn snugly.",
  WATCH:
    "One value has drifted out of its usual range. Rest for a few minutes, drink some water and check the sensor fit. If it clears, no action is needed; if it stays, tell the flight surgeon.",
  ATTENTION:
    "A value is well outside its safe range. Stop the current activity, sit down and breathe slowly, then contact the flight surgeon now and keep the monitor on.",
};

const HEADLINES: Record<HealthStatus, string> = {
  NORMAL: "No sustained unexplained deviations detected",
  WATCH:
    "A value is outside your expected range; monitoring whether it persists",
  ATTENTION: "A value needs attention now",
};

const round1 = (value: number) => Math.round(value * 10) / 10;

interface ReadingContext {
  parameters: ParameterEvaluations;
  stats: readonly BaselineStatSummary[];
  inFlight: boolean;
}

function referenceMean(
  context: ReadingContext,
  parameter: BaselineParameter,
): number | null {
  const reference = selectBaselineReference(
    context.stats,
    parameter,
    context.inFlight,
  );
  return reference ? round1(reference.mean) : null;
}

function singleReading(
  context: ReadingContext,
  parameter: "resp_rate_bpm" | "spo2_pct",
  unit: string,
): SingleReadingView | typeof unavailable {
  const evaluation = context.parameters[parameter];
  if (!evaluation) return unavailable;
  return {
    value: evaluation.value,
    unit,
    baseline: referenceMean(context, parameter),
    deviationPct: evaluation.baseline?.deviationPct ?? null,
    status: evaluation.status,
  };
}

// Heart rate and skin temperature have no pre-flight baseline session; they are compared with a per-astronaut
// reference value that the simulator also uses.
function vitalReading(
  context: ReadingContext,
  parameter: "hr_bpm" | "skin_temp_c",
  unit: string,
  reference: number,
): SingleReadingView | typeof unavailable {
  const evaluation = context.parameters[parameter];
  if (!evaluation) return unavailable;
  return {
    value: evaluation.value,
    unit,
    baseline: reference,
    deviationPct: Number((((evaluation.value - reference) / reference) * 100).toFixed(2)),
    status: evaluation.status,
  };
}

function buildReadings(
  latest: Reading,
  stats: readonly BaselineStatSummary[],
): OverviewReadings {
  // Evaluation carries the latest value of every parameter, including ones a sensor sent in an earlier record.
  const context: ReadingContext = {
    parameters: parseStoredEvaluation(latest.evaluation),
    stats,
    inFlight: latest.inFlight,
  };
  const {
    sbp_mmhg: systolic,
    dbp_mmhg: diastolic,
    glucose_mgdl: glucose,
  } = context.parameters;
  const baselineSystolic = referenceMean(context, "sbp_mmhg");
  const baselineDiastolic = referenceMean(context, "dbp_mmhg");

  return {
    respiratoryRate: singleReading(context, "resp_rate_bpm", "breaths/min"),
    oxygenSaturation: singleReading(context, "spo2_pct", "%"),
    bloodPressure:
      systolic && diastolic
        ? {
            systolic: systolic.value,
            diastolic: diastolic.value,
            unit: "mmHg",
            baseline:
              baselineSystolic !== null && baselineDiastolic !== null
                ? { systolic: baselineSystolic, diastolic: baselineDiastolic }
                : null,
            status: worstStatus([systolic.status, diastolic.status]),
          }
        : unavailable,
    bloodGlucose: glucose
      ? {
          value: glucose.value,
          unit: "mg/dL",
          fasting: latest.fasting,
          baseline: null,
          status: glucose.status,
        }
      : unavailable,
    heartRate: vitalReading(context, "hr_bpm", "bpm", round1(vitalReference(latest.astronautId).hr)),
    skinTemperature: vitalReading(context, "skin_temp_c", "°C", round1(vitalReference(latest.astronautId).sk)),
  };
}

// Builds the Overview screen: the astronaut's current status and latest readings against their baseline.
export class OverviewService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly baselineStats: BaselineStatsService,
    private readonly monitoringSession: MonitoringSessionService,
  ) {}

  async getOverview(astronautId: string): Promise<OverviewResponse> {
    const astronaut = await this.prisma.astronaut.findUnique({
      where: { id: astronautId },
    });
    if (!astronaut)
      throw new NotFoundError(
        "astronaut_not_found",
        `No astronaut with id ${astronautId}`,
      );

    const [latest, session, stats] = await Promise.all([
      this.prisma.reading.findFirst({
        where: { astronautId, status: { not: null } },
        orderBy: { timestampUtc: "desc" },
      }),
      this.monitoringSession.current(astronautId),
      this.baselineStats.summaries(astronautId),
    ]);

    return {
      astronautId,
      asOf: latest?.timestampUtc.toISOString() ?? null,
      missionDay: latest?.missionDay ?? null,
      inFlight: latest?.inFlight ?? null,
      bioMonitorConnected: session?.connected ?? false,
      status:
        latest?.status && latest.explanation
          ? {
              level: latest.status,
              headline: HEADLINES[latest.status],
              activityLevel: latest.activityLevel,
              reasons: [latest.explanation],
              advice: ADVICE[latest.status],
            }
          : null,
      sessionContext: {
        sessionId: session?.sessionId ?? null,
        baselineVerified: isBaselineApproved(stats),
        wearerAssociationConfirmed: session !== null,
        signalQuality: session?.signalQuality ?? null,
      },
      readings: latest ? buildReadings(latest, stats) : null,
    };
  }
}
