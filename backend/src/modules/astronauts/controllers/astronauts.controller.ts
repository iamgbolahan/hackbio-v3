import { Router } from "express";
import { asyncHandler } from "../../../middleware/async-handler";
import { eventsQuerySchema } from "../dto/events.dto";
import type { AstronautProfileService } from "../services/astronaut-profile.service";
import type { ConnectionService } from "../services/connection.service";
import type { OverviewService } from "../services/overview.service";
import type { StreamService } from "../services/stream.service";
import type { StatusEventsService } from "../services/status-events.service";

export interface AstronautsRouterServices {
  profiles: AstronautProfileService;
  overview: OverviewService;
  connection: ConnectionService;
  statusEvents: StatusEventsService;
  stream: StreamService;
}

// Read endpoints behind the four dashboard screens; paths match what the frontend already calls.
export function astronautsRouter(services: AstronautsRouterServices): Router {
  const router = Router();

  router.get(
    "/astronauts",
    asyncHandler(async (_req, res) => {
      res.json(await services.profiles.list());
    }),
  );
  router.get(
    "/profile/:astronautId",
    asyncHandler(async (req, res) => {
      res.json(
        await services.profiles.profile(req.params.astronautId as string),
      );
    }),
  );
  router.get(
    "/baseline/:astronautId",
    asyncHandler(async (req, res) => {
      res.json(
        await services.profiles.baseline(req.params.astronautId as string),
      );
    }),
  );
  router.get(
    "/overview/:astronautId",
    asyncHandler(async (req, res) => {
      res.json(
        await services.overview.getOverview(req.params.astronautId as string),
      );
    }),
  );
  router.get(
    "/connection/:astronautId",
    asyncHandler(async (req, res) => {
      res.json(
        await services.connection.getConnection(
          req.params.astronautId as string,
        ),
      );
    }),
  );
  router.get(
    "/events/:astronautId",
    asyncHandler(async (req, res) => {
      const query = eventsQuerySchema.parse(req.query);
      res.json(
        await services.statusEvents.list(
          req.params.astronautId as string,
          query,
        ),
      );
    }),
  );

  router.get(
    "/stream/:astronautId",
    asyncHandler(async (req, res) => {
      const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 500);
      res.json(await services.stream.recent(req.params.astronautId as string, limit));
    }),
  );

  return router;
}
