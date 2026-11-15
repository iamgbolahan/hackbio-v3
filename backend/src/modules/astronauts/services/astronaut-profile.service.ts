import type { PrismaClient, TestCondition } from "generated/prisma/client";
import { NotFoundError } from "../../../middleware/error-handler";
import { isBaselineApproved } from "../../baselines/helpers/baseline-approval";
import { unavailable } from "../../metrics/metric-catalog";
import type {
  AstronautSummary,
  BaselineResponse,
  ProfileResponse,
} from "../dto/profile.dto";
import { bloodPressureCard, singleValueCard } from "../helpers/baseline-cards";
import type { MonitoringSessionService } from "./monitoring-session.service";

const CONDITION_ORDER: readonly TestCondition[] = [
  "normal_earth",
  "head_down_tilt",
  "dry_immersion",
  "raised_co2",
  "reduced_pressure",
];

const METHOD_DESCRIPTION =
  "Proposed 7–14 pre-flight days · repeated standardized resting sessions · mean and sample SD per test condition, never pooled · fewer than 6 valid sessions is provisional · separate from in-flight trends";

// Presents an astronaut's identity and approved pre-flight baseline.
export class AstronautProfileService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly monitoringSession: MonitoringSessionService,
  ) {}

  async list(): Promise<AstronautSummary[]> {
    const astronauts = await this.prisma.astronaut.findMany({
      orderBy: { id: "asc" },
    });
    return astronauts.map((a) => ({
      astronautId: a.id,
      displayName: a.displayName,
      crewNumber: a.crewNumber,
      sex: a.sex,
      launchDay: a.launchDay,
      missionName: a.missionName,
    }));
  }

  async profile(astronautId: string): Promise<ProfileResponse> {
    const astronaut = await this.findAstronaut(astronautId);
    const [stats, session] = await Promise.all([
      this.prisma.baselineStat.findMany({ where: { astronautId } }),
      this.monitoringSession.current(astronautId),
    ]);
    const approved = isBaselineApproved(stats);

    return {
      astronautId: astronaut.id,
      displayName: astronaut.displayName,
      crewNumber: astronaut.crewNumber,
      sex: astronaut.sex,
      mission: astronaut.missionName ? { name: astronaut.missionName } : null,
      // The device performs the biometric check; with no auth in this prototype the backend only confirms the profile exists.
      identityStatus: {
        state: "verified",
        description: "Astronaut identity verified via onboard device",
      },
      baselineStatus: approved
        ? { state: "approved", label: "Approved baseline" }
        : { state: "pending", label: "Baseline pending" },
      deviceStatus: session?.connected
        ? { state: "connected", label: "Bio-Monitor linked" }
        : { state: "disconnected", label: "Bio-Monitor not connected" },
      updatedAt: astronaut.updatedAt.toISOString(),
    };
  }

  async baseline(astronautId: string): Promise<BaselineResponse> {
    await this.findAstronaut(astronautId);
    const stats = await this.prisma.baselineStat.findMany({
      where: { astronautId },
    });
    const conditions = CONDITION_ORDER.filter((condition) =>
      stats.some((s) => s.testCondition === condition),
    );

    return {
      approvalStatus: {
        label: isBaselineApproved(stats)
          ? "Approved pre-flight baseline"
          : stats.length > 0
            ? "Baseline incomplete or provisional"
            : "Awaiting baseline data",
      },
      methodDescription: METHOD_DESCRIPTION,
      parameters: {
        heartRate: unavailable,
        skinTemperature: unavailable,
        respiratoryRate: singleValueCard(
          stats,
          "normal_earth",
          "resp_rate_bpm",
        ),
        oxygenSaturation: singleValueCard(stats, "normal_earth", "spo2_pct"),
        bloodPressure: bloodPressureCard(stats, "normal_earth"),
      },
      byCondition: conditions.map((condition) => ({
        condition,
        respiratoryRate: singleValueCard(stats, condition, "resp_rate_bpm"),
        oxygenSaturation: singleValueCard(stats, condition, "spo2_pct"),
        bloodPressure: bloodPressureCard(stats, condition),
      })),
    };
  }

  private async findAstronaut(astronautId: string) {
    const astronaut = await this.prisma.astronaut.findUnique({
      where: { id: astronautId },
    });
    if (!astronaut)
      throw new NotFoundError(
        "astronaut_not_found",
        `No astronaut with id ${astronautId}`,
      );
    return astronaut;
  }
}
