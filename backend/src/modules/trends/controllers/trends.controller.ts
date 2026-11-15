import { Router } from "express";
import { asyncHandler } from "../../../middleware/async-handler";
import { trendsQuerySchema } from "../dto/trends.dto";
import type { TrendsService } from "../services/trends.service";

export function trendsRouter(trends: TrendsService): Router {
  const router = Router();

  router.get(
    "/trends/:astronautId",
    asyncHandler(async (req, res) => {
      const { period } = trendsQuerySchema.parse(req.query);
      res.json(
        await trends.getTrends(req.params.astronautId as string, period),
      );
    }),
  );

  return router;
}
