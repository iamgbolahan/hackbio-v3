import type { Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { env } from "../../../config/env";
import { asyncHandler } from "../../../middleware/async-handler";
import { requireAuth, SESSION_COOKIE, contextOf, rateLimit } from "../auth.middleware";
import type { AuditService } from "../services/audit.service";
import type { AuthService, CreatedSession } from "../services/auth.service";
import type { MonitorVerificationService } from "../services/monitor-verification.service";
import type { WebAuthnService } from "../services/webauthn.service";

const loginBody = z.object({
  loginId: z.string().trim().min(1).max(40),
  passcode: z.string().min(1).max(200),
});
const changeBody = z.object({
  current: z.string().min(1).max(200),
  next: z.string().min(1).max(200),
});

export interface AuthRouterServices {
  auth: AuthService;
  webauthn: WebAuthnService;
  monitor: MonitorVerificationService;
  audit: AuditService;
}

function setSessionCookie(res: Response, session: CreatedSession) {
  res.cookie(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.COOKIE_SECURE,
    expires: session.expiresAt,
    path: "/",
  });
}

const publicUser = (p: CreatedSession["principal"]) => ({
  loginId: p.loginId,
  displayName: p.displayName,
  role: p.role,
  astronautId: p.astronautId,
  method: p.method,
  mustChangePasscode: p.mustChangePasscode,
});

export function authRouter(services: AuthRouterServices): Router {
  const router = Router();
  const limiter = rateLimit(30, 15 * 60_000);

  router.post(
    "/auth/login",
    limiter,
    asyncHandler(async (req, res) => {
      const body = loginBody.parse(req.body);
      const session = await services.auth.loginWithPasscode(
        body.loginId,
        body.passcode,
        contextOf(req),
      );
      setSessionCookie(res, session);
      res.json({ user: publicUser(session.principal) });
    }),
  );

  router.post(
    "/auth/passkey/login/options",
    limiter,
    asyncHandler(async (req, res) => {
      const { loginId } = z.object({ loginId: z.string().trim().min(1) }).parse(req.body);
      res.json(await services.webauthn.loginOptions(loginId));
    }),
  );

  router.post(
    "/auth/passkey/login/verify",
    limiter,
    asyncHandler(async (req, res) => {
      const body = z
        .object({ loginId: z.string().trim().min(1), response: z.any() })
        .parse(req.body);
      const session = await services.webauthn.verifyLogin(
        body.loginId,
        body.response,
        contextOf(req),
      );
      setSessionCookie(res, session);
      res.json({ user: publicUser(session.principal) });
    }),
  );

  router.post(
    "/auth/logout",
    asyncHandler(async (req, res) => {
      if (req.auth) await services.auth.logout(req.auth, contextOf(req));
      res.clearCookie(SESSION_COOKIE, { path: "/" });
      res.json({ ok: true });
    }),
  );

  // Everything below needs a signed-in user.
  router.use("/auth", requireAuth);

  router.get(
    "/auth/me",
    asyncHandler(async (req, res) => {
      const principal = req.auth!;
      const [passkeys, monitor] = await Promise.all([
        services.webauthn.list(principal.userId),
        principal.astronautId
          ? services.monitor.current(principal.astronautId)
          : Promise.resolve(null),
      ]);
      res.json({
        user: publicUser(principal),
        passkeys,
        monitor,
      });
    }),
  );

  router.post(
    "/auth/passcode",
    asyncHandler(async (req, res) => {
      const body = changeBody.parse(req.body);
      await services.auth.changePasscode(req.auth!, body.current, body.next, contextOf(req));
      res.json({ ok: true });
    }),
  );

  router.get(
    "/auth/activity",
    asyncHandler(async (req, res) => {
      const rows = await services.audit.recentForUser(req.auth!.userId, 20);
      res.json(
        rows.map((row) => ({
          at: row.at.toISOString(),
          action: row.action,
          success: row.success,
          ip: row.ip,
        })),
      );
    }),
  );

  router.post(
    "/auth/passkey/register/options",
    asyncHandler(async (req, res) => {
      res.json(await services.webauthn.registrationOptions(req.auth!));
    }),
  );

  router.post(
    "/auth/passkey/register/verify",
    asyncHandler(async (req, res) => {
      const body = z
        .object({ response: z.any(), deviceLabel: z.string().max(60).default("This device") })
        .parse(req.body);
      await services.webauthn.verifyRegistration(
        req.auth!,
        body.response,
        body.deviceLabel,
        contextOf(req),
      );
      res.status(201).json({ ok: true, passkeys: await services.webauthn.list(req.auth!.userId) });
    }),
  );

  router.delete(
    "/auth/passkeys/:id",
    asyncHandler(async (req, res) => {
      await services.webauthn.remove(req.auth!, req.params.id as string);
      res.json({ ok: true });
    }),
  );

  router.post(
    "/auth/monitor/verify",
    asyncHandler(async (req, res) => {
      const { pairingCode } = z
        .object({ pairingCode: z.string().trim().min(3).max(60) })
        .parse(req.body);
      const session = await services.monitor.verify(req.auth!, pairingCode, contextOf(req));
      res.status(201).json({ monitor: session });
    }),
  );

  router.post(
    "/auth/monitor/end",
    asyncHandler(async (req, res) => {
      await services.monitor.end(req.auth!, contextOf(req));
      res.json({ ok: true });
    }),
  );

  return router;
}
