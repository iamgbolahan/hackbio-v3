import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class NotFoundError extends HttpError {
  constructor(code: string, message: string) {
    super(404, code, message);
  }
}

export class BadRequestError extends HttpError {
  constructor(code: string, message: string) {
    super(400, code, message);
  }
}

export class ConflictError extends HttpError {
  constructor(code: string, message: string) {
    super(409, code, message);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(code = "unauthenticated", message = "Sign in required") {
    super(401, code, message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(code = "forbidden", message = "You may not access this") {
    super(403, code, message);
  }
}

export class TooManyRequestsError extends HttpError {
  constructor(code: string, message: string) {
    super(429, code, message);
  }
}

export const notFoundRoute: RequestHandler = (req, res) => {
  res.status(404).json({
    error: "route_not_found",
    message: `No route for ${req.method} ${req.path}`,
  });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "validation_failed",
      details: err.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  // Malformed JSON from express.json() arrives as a SyntaxError with status 400.
  if (err instanceof SyntaxError && "status" in err && err.status === 400) {
    res.status(400).json({ error: "invalid_json", message: err.message });
    return;
  }
  console.error("Unhandled error", err);
  res
    .status(500)
    .json({ error: "internal_error", message: "Something went wrong" });
};
