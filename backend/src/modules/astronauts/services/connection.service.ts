import type { PrismaClient } from "generated/prisma/client";
import { NotFoundError } from "../../../middleware/error-handler";
import { isBaselineApproved } from "../../baselines/helpers/baseline-approval";
import type { BaselineStatsService } from "../../baselines/services/baseline-stats.service";
import type { ConnectionResponse } from "../dto/connection.dto";
import type { MonitoringSessionService } from "./monitoring-session.service";

// Reports the proposal's four connection steps: identity, baseline, Bio-Monitor session, monitoring.
export class ConnectionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly baselineStats: BaselineStatsService,
    private readonly monitoringSession: MonitoringSessionService,
  ) {}

  async getConnection(astronautId: string): Promise<ConnectionResponse> {
    const astronaut = await this.prisma.astronaut.findUnique({
      where: { id: astronautId },
    });
    if (!astronaut)
      throw new NotFoundError(
        "astronaut_not_found",
        `No astronaut with id ${astronautId}`,
      );

    const [stats, session] = await Promise.all([
      this.baselineStats.summaries(astronautId),
      this.monitoringSession.current(astronautId),
    ]);
    const baselineReady = isBaselineApproved(stats);
    const connected = session?.connected ?? false;

    return {
      astronautId,
      steps: [
        {
          step: 1,
          key: "verify_identity",
          label: "Verify identity",
          status: "verified",
          note: "Signed in with a verified crew account (passcode or fingerprint passkey).",
        },
        {
          step: 2,
          key: "retrieve_baseline",
          label: "Retrieve approved baseline",
          status: baselineReady ? "verified" : "pending",
        },
        {
          step: 3,
          key: "connect_bio_monitor",
          label: "Connect Bio-Monitor",
          status: connected ? "connected" : "waiting",
          sessionId: session?.sessionId ?? null,
          lastReadingAt: session?.lastReadingAt.toISOString() ?? null,
        },
        {
          step: 4,
          key: "start_monitoring",
          label: "Start monitoring",
          status: baselineReady && connected ? "ready" : "blocked",
        },
      ],
    };
  }
}
