import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { UserRole } from "generated/prisma/client";
import { env } from "../../config/env";
import {
  ForbiddenError,
  TooManyRequestsError,
  UnauthorizedError,
} from "../../middleware/error-handler";
import type { AuditService } from "./services/audit.service";
import type { AuthPrincipal, AuthService, RequestContext } from "./services/auth.service";
import type { MonitorVerificationService } from "./services/monitor-verification.service";

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthPrincipal | null;
  }
}

export const SESSION_COOKIE = "hb_session";

export function contextOf(req: Request): RequestContext {
  return {
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

// Looks the cookie up on every request; downstream guards read req.auth.
export function attachAuth(auth: AuthService): RequestHandler {
  return (req, _res, next) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token) {
      req.auth = null;
      next();
      return;
    }
    auth
      .resolve(token)
      .then((principal) => {
        req.auth = principal;
        next();
      })
      .catch(next);
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    next(new UnauthorizedError());
    return;
  }
  next();
};

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(new UnauthorizedError());
    if (!roles.includes(req.auth.role))
      return next(new ForbiddenError("wrong_role", "Your role cannot do this."));
    next();
  };
}

// An astronaut may only open their own record; flight surgeons and admins may open any.
export function requireAstronautAccess(audit: AuditService): RequestHandler {
  return (req, _res, next) => {
    const principal = req.auth;
    if (!principal) return next(new UnauthorizedError());
    const astronautId = req.params.astronautId;
    if (astronautId === undefined) return next();
    if (principal.role === "astronaut" && principal.astronautId !== astronautId) {
      void audit.record({
        userId: principal.userId,
        loginId: principal.loginId,
        astronautId,
        action: "access_denied",
        success: false,
        ip: req.ip ?? null,
        detail: { path: req.path },
      });
      return next(
        new ForbiddenError(
          "not_your_record",
          "You can only view your own health record.",
        ),
      );
    }
    next();
  };
}

// State-changing requests from a browser must come from our own pages: a matching Origin and a custom header
// (which a cross-site form cannot add). Together with SameSite cookies this blocks cross-site request forgery.
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  const allowed = new Set([env.WEBAUTHN_ORIGIN, ...env.CORS_ORIGINS]);
  if (origin && !allowed.has(origin))
    return next(new ForbiddenError("bad_origin", "Request origin not allowed."));
  // Without a session cookie there is nothing to forge (sign-in itself, device gateways).
  if (!req.cookies?.[SESSION_COOKIE]) return next();
  if (req.get("x-requested-with") !== "hackbio")
    return next(new ForbiddenError("csrf", "Missing request header."));
  next();
};

// Simple in-memory limiter for sign-in attempts per address.
export function rateLimit(max: number, windowMs: number): RequestHandler {
  const hits = new Map<string, number[]>();
  return (req, _res, next) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return next(
        new TooManyRequestsError(
          "rate_limited",
          "Too many sign-in attempts. Wait a few minutes.",
        ),
      );
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

function deviceKeyMatches(req: Request): boolean {
  const supplied = req.get("x-device-key");
  if (!env.DEVICE_API_KEY || !supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(env.DEVICE_API_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Who may write data: an admin, a flight surgeon (ultrasound entry), or a Bio-Monitor gateway holding the device
// key. A gateway may only post readings, and only into a session an astronaut has verified.
export function ingestGuard(
  kind: "readings" | "ultrasound" | "upload",
  monitor: MonitorVerificationService,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.auth?.role;
    if (role === "admin") return next();
    if (role === "flight_surgeon" && kind === "ultrasound") return next();
    if (kind === "readings" && deviceKeyMatches(req)) {
      const body = req.body as { astronaut_id?: unknown; session_id?: unknown };
      if (typeof body?.astronaut_id !== "string" || typeof body?.session_id !== "string")
        return next(new ForbiddenError("no_session", "A verified session id is required."));
      monitor
        .isOpen(body.astronaut_id, body.session_id)
        .then((open) =>
          open
            ? next()
            : next(
                new ForbiddenError(
                  "session_not_verified",
                  "This session is not verified for that astronaut.",
                ),
              ),
        )
        .catch(next);
      return;
    }
    void res;
    next(req.auth ? new ForbiddenError("wrong_role", "Your role cannot do this.") : new UnauthorizedError());
  };
}
