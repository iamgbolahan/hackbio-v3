import { Router } from "express";
import { asyncHandler } from "../../../middleware/async-handler";
import { BadRequestError } from "../../../middleware/error-handler";
import { uploadQuerySchema } from "../dto/upload.dto";
import type { CsvUploadService } from "../services/csv-upload.service";

// Enough to locate the problem rows without returning a 17k-line response for a bad file.
const MAX_ERROR_ROWS = 50;

export function uploadRouter(csvUpload: CsvUploadService): Router {
  const router = Router();

  router.post(
    "/upload",
    asyncHandler(async (req, res) => {
      const { type } = uploadQuerySchema.parse(req.query);
      if (typeof req.body !== "string" || req.body.trim() === "") {
        throw new BadRequestError(
          "expected_csv",
          "Send the file as text/csv in the request body",
        );
      }
      const summary = await csvUpload.upload(type, req.body);
      res.status(200).json({
        type: summary.type,
        rows: summary.rows,
        stored: summary.stored,
        duplicates: summary.duplicates,
        artifacts: summary.artifacts,
        errors: summary.errorRows.length,
        error_rows: summary.errorRows.slice(0, MAX_ERROR_ROWS),
      });
    }),
  );

  return router;
}
