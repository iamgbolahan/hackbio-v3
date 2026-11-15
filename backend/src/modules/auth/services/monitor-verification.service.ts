import type { PrismaClient } from "generated/prisma/client";
import { env } from "../../../config/env";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../../middleware/error-handler";
import { verifySecret } from "../helpers/password";
import type { AuditService } from "./audit.service";
import type { AuthPrincipal, RequestContext } from "./auth.service";

export interface MonitorSessionView {
  sessionId: string;
  deviceId: string;
  deviceLabel: string;
  startedAt: string;
  missionDay: number | null;
}

const DAY_MS = 86_400_000;

export function missionDayFor(date: Date): number {
  const start = Date.parse(`${env.MISSION_START_DATE}T00:00:00Z`);
  return Math.floor((date.getTime() - start) / DAY_MS) + 1;
}

// Links a physical Bio-Monitor to the signed-in astronaut. Readings are only accepted inside such a session, so a
// device can never feed data into the wrong astronaut's baseline.
export class MonitorVerificationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  async current(astronautId: string): Promise<MonitorSessionView | null> {
    const session = await this.prisma.monitoringSession.findFirst({
      where: { astronautId, endedAt: null },
      orderBy: { startedAt: "desc" },
      include: { device: true },
    });
    return session
      ? {
          sessionId: session.sessionId,
          deviceId: session.deviceId,
          deviceLabel: session.device.label,
          startedAt: session.startedAt.toISOString(),
          missionDay: session.missionDay,
        }
      : null;
  }

  async verify(
    principal: AuthPrincipal,
    pairingCode: string,
    ctx: RequestContext,
  ): Promise<MonitorSessionView> {
    if (principal.role !== "astronaut" || !principal.astronautId)
      throw new ForbiddenError(
        "astronaut_only",
        "Only an astronaut can connect their own Bio-Monitor.",
      );
    const astronautId = principal.astronautId;
    const devices = await this.prisma.bioMonitorDevice.findMany({
      where: { astronautId, active: true },
    });
    let matched = null;
    for (const device of devices) {
      if (await verifySecret(pairingCode.trim().toUpperCase(), device.pairingHash)) {
        matched = device;
        break;
      }
    }
    if (!matched) {
      await this.audit.record({
        userId: principal.userId,
        loginId: principal.loginId,
        astronautId,
        action: "monitor_verify",
        success: false,
        ip: ctx.ip,
        detail: { reason: "code_not_assigned_to_this_astronaut" },
      });
      throw new BadRequestError(
        "device_not_assigned",
        "That pairing code does not belong to a Bio-Monitor assigned to you.",
      );
    }

    const now = new Date();
    const missionDay = missionDayFor(now);
    const day = String(missionDay).padStart(2, "0");
    const sameDay = await this.prisma.monitoringSession.count({
      where: { astronautId, sessionId: { startsWith: `${astronautId}-D${day}` } },
    });
    const sessionId = `${astronautId}-D${day}${sameDay > 0 ? `-${sameDay + 1}` : ""}`;

    await this.prisma.$transaction([
      this.prisma.monitoringSession.updateMany({
        where: { astronautId, endedAt: null },
        data: { endedAt: now },
      }),
      this.prisma.monitoringSession.create({
        data: {
          sessionId,
          astronautId,
          deviceId: matched.deviceId,
          verifiedByUserId: principal.userId,
          missionDay,
        },
      }),
    ]);
    await this.audit.record({
      userId: principal.userId,
      loginId: principal.loginId,
      astronautId,
      action: "monitor_verify",
      success: true,
      ip: ctx.ip,
      detail: { sessionId, deviceId: matched.deviceId },
    });
    return {
      sessionId,
      deviceId: matched.deviceId,
      deviceLabel: matched.label,
      startedAt: now.toISOString(),
      missionDay,
    };
  }

  async end(principal: AuthPrincipal, ctx: RequestContext): Promise<void> {
    if (!principal.astronautId)
      throw new NotFoundError("no_session", "No monitoring session to end");
    await this.prisma.monitoringSession.updateMany({
      where: { astronautId: principal.astronautId, endedAt: null },
      data: { endedAt: new Date() },
    });
    await this.audit.record({
      userId: principal.userId,
      loginId: principal.loginId,
      astronautId: principal.astronautId,
      action: "monitor_end",
      success: true,
      ip: ctx.ip,
    });
  }

  // Used by the ingest guard: is this session id the live, verified session of this astronaut?
  async isOpen(astronautId: string, sessionId: string): Promise<boolean> {
    const session = await this.prisma.monitoringSession.findUnique({
      where: { sessionId },
    });
    return Boolean(
      session && session.astronautId === astronautId && session.endedAt === null,
    );
  }
}
