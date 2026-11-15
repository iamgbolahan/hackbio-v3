import type { PrismaClient, SignalQuality } from "generated/prisma/client";

export interface MonitoringSession {
  sessionId: string;
  lastReadingAt: Date;
  signalQuality: SignalQuality;
  connected: boolean;
}

// Decides whether an astronaut's Bio-Monitor session is live, from the time of its latest reading.
export class MonitoringSessionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly connectedWithinMin: number,
  ) {}

  async current(
    astronautId: string,
    now: Date = new Date(),
  ): Promise<MonitoringSession | null> {
    const latest = await this.prisma.reading.findFirst({
      where: { astronautId },
      orderBy: { timestampUtc: "desc" },
      select: { sessionId: true, timestampUtc: true, signalQuality: true },
    });
    if (!latest) return null;
    return {
      sessionId: latest.sessionId,
      lastReadingAt: latest.timestampUtc,
      signalQuality: latest.signalQuality,
      connected:
        now.getTime() - latest.timestampUtc.getTime() <=
        this.connectedWithinMin * 60_000,
    };
  }
}
