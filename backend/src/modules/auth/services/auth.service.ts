import { createHash, randomBytes } from "node:crypto";
import type {
  AuthMethod,
  PrismaClient,
  User,
  UserRole,
} from "generated/prisma/client";
import { env } from "../../../config/env";
import {
  BadRequestError,
  TooManyRequestsError,
  UnauthorizedError,
} from "../../../middleware/error-handler";
import {
  burnVerifyTime,
  hashSecret,
  minimumPasscodeProblem,
  verifySecret,
} from "../helpers/password";
import type { AuditService } from "./audit.service";

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export interface AuthPrincipal {
  userId: string;
  loginId: string;
  displayName: string;
  role: UserRole;
  astronautId: string | null;
  method: AuthMethod;
  sessionId: string;
  mustChangePasscode: boolean;
}

export interface CreatedSession {
  token: string;
  principal: AuthPrincipal;
  expiresAt: Date;
}

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  // Same answer for "no such crew id" and "wrong passcode": the response never says which one was wrong.
  async loginWithPasscode(
    loginId: string,
    passcode: string,
    ctx: RequestContext,
  ): Promise<CreatedSession> {
    const user = await this.prisma.user.findUnique({
      where: { loginId: loginId.trim() },
    });
    const refused = (reason: string, found: User | null) =>
      this.audit.record({
        userId: found?.id ?? null,
        loginId,
        astronautId: found?.astronautId ?? null,
        action: "login_passcode",
        success: false,
        ip: ctx.ip,
        detail: { reason },
      });

    if (!user || user.disabled) {
      await burnVerifyTime(passcode);
      await refused(user ? "disabled" : "unknown_login_id", user);
      throw new UnauthorizedError(
        "invalid_credentials",
        "Crew ID or passcode is not correct.",
      );
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await refused("locked", user);
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new TooManyRequestsError(
        "account_locked",
        `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      );
    }
    if (!(await verifySecret(passcode, user.passcodeHash))) {
      const failedAttempts = user.failedAttempts + 1;
      const lock = failedAttempts >= env.LOCKOUT_ATTEMPTS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedAttempts: lock ? 0 : failedAttempts,
          lockedUntil: lock
            ? new Date(Date.now() + env.LOCKOUT_MIN * 60_000)
            : user.lockedUntil,
        },
      });
      await refused("wrong_passcode", user);
      throw new UnauthorizedError(
        "invalid_credentials",
        "Crew ID or passcode is not correct.",
      );
    }
    return this.createSession(user, "passcode", ctx);
  }

  async createSession(
    user: User,
    method: AuthMethod,
    ctx: RequestContext,
  ): Promise<CreatedSession> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { failedAttempts: 0, lockedUntil: null },
      }),
      this.prisma.authSession.create({
        data: {
          id: sha256(token),
          userId: user.id,
          method,
          expiresAt,
          ip: ctx.ip,
          userAgent: ctx.userAgent?.slice(0, 300) ?? null,
        },
      }),
    ]);
    await this.audit.record({
      userId: user.id,
      loginId: user.loginId,
      astronautId: user.astronautId,
      action: method === "biometric" ? "login_biometric" : "login_passcode",
      success: true,
      ip: ctx.ip,
    });
    return {
      token,
      expiresAt,
      principal: this.principalOf(user, method, sha256(token)),
    };
  }

  // Returns null for an unknown, expired, idle or revoked session; refreshes the idle timer otherwise.
  async resolve(token: string): Promise<AuthPrincipal | null> {
    const id = sha256(token);
    const session = await this.prisma.authSession.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.user.disabled) return null;
    const now = Date.now();
    if (session.expiresAt.getTime() <= now) return null;
    if (now - session.lastSeenAt.getTime() > env.SESSION_IDLE_MIN * 60_000)
      return null;
    if (now - session.lastSeenAt.getTime() > 15_000) {
      await this.prisma.authSession.update({
        where: { id },
        data: { lastSeenAt: new Date(now) },
      });
    }
    return this.principalOf(session.user, session.method, id);
  }

  async logout(principal: AuthPrincipal, ctx: RequestContext): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id: principal.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      userId: principal.userId,
      loginId: principal.loginId,
      astronautId: principal.astronautId,
      action: "logout",
      success: true,
      ip: ctx.ip,
    });
  }

  async changePasscode(
    principal: AuthPrincipal,
    current: string,
    next: string,
    ctx: RequestContext,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: principal.userId },
    });
    if (!(await verifySecret(current, user.passcodeHash))) {
      await this.audit.record({
        userId: user.id,
        loginId: user.loginId,
        astronautId: user.astronautId,
        action: "change_passcode",
        success: false,
        ip: ctx.ip,
        detail: { reason: "wrong_current" },
      });
      throw new UnauthorizedError(
        "invalid_credentials",
        "The current passcode is not correct.",
      );
    }
    const problem = minimumPasscodeProblem(next);
    if (problem) throw new BadRequestError("weak_passcode", problem);
    if (next === current)
      throw new BadRequestError(
        "weak_passcode",
        "The new passcode must be different.",
      );
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passcodeHash: await hashSecret(next), mustChangePasscode: false },
      }),
      // Every other signed-in device is signed out.
      this.prisma.authSession.updateMany({
        where: { userId: user.id, revokedAt: null, NOT: { id: principal.sessionId } },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      userId: user.id,
      loginId: user.loginId,
      astronautId: user.astronautId,
      action: "change_passcode",
      success: true,
      ip: ctx.ip,
    });
  }

  private principalOf(
    user: User,
    method: AuthMethod,
    sessionId: string,
  ): AuthPrincipal {
    return {
      userId: user.id,
      loginId: user.loginId,
      displayName: user.displayName,
      role: user.role,
      astronautId: user.astronautId,
      method,
      sessionId,
      mustChangePasscode: user.mustChangePasscode,
    };
  }
}
