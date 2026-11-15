import type { HealthStatus, PrismaClient } from "generated/prisma/client";
import {
  BadRequestError,
  NotFoundError,
} from "../../../middleware/error-handler";
import {
  MAX_EVENT_WINDOW_DAYS,
  type EventsQuery,
  type EventsResponse,
  type StatusEvent,
} from "../dto/events.dto";

const DAY_MS = 86_400_000;

// Lists the moments an astronaut's overall status changed, for the demo timeline and for checking results.
export class StatusEventsService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(astronautId: string, query: EventsQuery): Promise<EventsResponse> {
    const astronaut = await this.prisma.astronaut.findUnique({
      where: { id: astronautId },
    });
    if (!astronaut)
      throw new NotFoundError(
        "astronaut_not_found",
        `No astronaut with id ${astronautId}`,
      );

    const window = await this.resolveWindow(astronautId, query);
    if (!window) return { astronautId, from: null, to: null, events: [] };

    const [before, readings] = await Promise.all([
      this.prisma.reading.findFirst({
        where: {
          astronautId,
          status: { not: null },
          timestampUtc: { lt: window.from },
        },
        orderBy: { timestampUtc: "desc" },
        select: { status: true },
      }),
      this.prisma.reading.findMany({
        where: {
          astronautId,
          status: { not: null },
          timestampUtc: { gte: window.from, lte: window.to },
        },
        orderBy: { timestampUtc: "asc" },
        select: { timestampUtc: true, status: true, explanation: true },
      }),
    ]);

    const events: StatusEvent[] = [];
    let previous: HealthStatus | null = before?.status ?? null;
    for (const reading of readings) {
      if (reading.status === null || reading.status === previous) continue;
      events.push({
        timestampUtc: reading.timestampUtc.toISOString(),
        from: previous,
        to: reading.status,
        explanation: reading.explanation,
      });
      previous = reading.status;
    }
    return {
      astronautId,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      events,
    };
  }

  // Defaults to the 7 days ending at the latest reading; any window is capped so one request stays bounded.
  private async resolveWindow(
    astronautId: string,
    query: EventsQuery,
  ): Promise<{ from: Date; to: Date } | null> {
    let to = query.to;
    if (!to) {
      const latest = await this.prisma.reading.findFirst({
        where: { astronautId },
        orderBy: { timestampUtc: "desc" },
        select: { timestampUtc: true },
      });
      if (!latest) return null;
      to = latest.timestampUtc;
    }
    const from = query.from ?? new Date(to.getTime() - 7 * DAY_MS);
    if (to.getTime() - from.getTime() > MAX_EVENT_WINDOW_DAYS * DAY_MS) {
      throw new BadRequestError(
        "window_too_large",
        `The event window may span at most ${MAX_EVENT_WINDOW_DAYS} days`,
      );
    }
    return { from, to };
  }
}
