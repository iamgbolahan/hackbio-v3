import type { HealthStatus } from "generated/prisma/client";
import { z } from "zod";

export const MAX_EVENT_WINDOW_DAYS = 31;

const instant = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

export const eventsQuerySchema = z
  .object({ from: instant.optional(), to: instant.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: "from must not be after to",
    path: ["from"],
  });

export type EventsQuery = z.output<typeof eventsQuerySchema>;

export interface StatusEvent {
  timestampUtc: string;
  from: HealthStatus | null;
  to: HealthStatus;
  explanation: string | null;
}

export interface EventsResponse {
  astronautId: string;
  from: string | null;
  to: string | null;
  events: StatusEvent[];
}
