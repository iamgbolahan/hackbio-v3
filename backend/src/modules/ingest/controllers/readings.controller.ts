import { Router } from "express";
import { asyncHandler } from "../../../middleware/async-handler";
import { readingRecordSchema } from "../dto/reading.dto";
import type { ReadingIngestService } from "../services/reading-ingest.service";

export function readingsRouter(readingIngest: ReadingIngestService): Router {
  const router = Router();

  router.post(
    "/readings",
    asyncHandler(async (req, res) => {
      const outcome = await readingIngest.ingestOne(
        readingRecordSchema.parse(req.body),
      );
      if (!outcome.stored) {
        res.status(200).json({ stored: false, duplicate: true });
        return;
      }
      res.status(201).json({
        stored: true,
        signal_quality: outcome.signalQuality,
        status: outcome.status,
        explanation: outcome.explanation,
      });
    }),
  );

  return router;
}
