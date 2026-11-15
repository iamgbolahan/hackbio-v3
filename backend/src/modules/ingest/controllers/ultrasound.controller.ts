import { Router } from "express";
import { asyncHandler } from "../../../middleware/async-handler";
import { ConflictError } from "../../../middleware/error-handler";
import { ultrasoundRecordSchema } from "../dto/ultrasound.dto";
import type { UltrasoundIngestService } from "../services/ultrasound-ingest.service";

export function ultrasoundRouter(
  ultrasoundIngest: UltrasoundIngestService,
): Router {
  const router = Router();

  router.post(
    "/ultrasound",
    asyncHandler(async (req, res) => {
      const record = ultrasoundRecordSchema.parse(req.body);
      const outcome = await ultrasoundIngest.ingest(record);
      if (!outcome.stored) {
        throw new ConflictError(
          "scan_already_exists",
          `A scan for ${record.astronautId} at ${record.timestampUtc.toISOString()} already exists`,
        );
      }
      res.status(201).json({
        stored: true,
        status: outcome.status,
        muscle_loss_pct: outcome.muscleLossPct,
        explanation: outcome.explanation,
      });
    }),
  );

  return router;
}
