import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { PrismaClient } from "generated/prisma/client";
import { env } from "../../../config/env";
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
} from "../../../middleware/error-handler";
import type { AuditService } from "./audit.service";
import type { AuthService, AuthPrincipal, RequestContext } from "./auth.service";

const CHALLENGE_TTL_MS = 5 * 60_000;

interface PendingChallenge {
  challenge: string;
  expiresAt: number;
}

// Fingerprint / face / security-key sign-in. The operating system does the biometric check and hands the
// app a signed proof; the server never sees a fingerprint, only the public key registered for that device.
export class WebAuthnService {
  // Challenges live in memory: they last minutes and are single-use. Use a shared store if you run several servers.
  private readonly challenges = new Map<string, PendingChallenge>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  async registrationOptions(principal: AuthPrincipal) {
    const existing = await this.prisma.passkeyCredential.findMany({
      where: { userId: principal.userId },
    });
    const options = await generateRegistrationOptions({
      rpName: env.WEBAUTHN_RP_NAME,
      rpID: env.WEBAUTHN_RP_ID,
      userName: principal.loginId,
      userDisplayName: principal.displayName,
      userID: new TextEncoder().encode(principal.userId),
      attestationType: "none",
      excludeCredentials: existing.map((credential) => ({
        id: credential.id,
        transports: credential.transports as AuthenticatorTransport[],
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
    });
    this.remember(`reg:${principal.userId}`, options.challenge);
    return options;
  }

  async verifyRegistration(
    principal: AuthPrincipal,
    response: RegistrationResponseJSON,
    deviceLabel: string,
    ctx: RequestContext,
  ) {
    const challenge = this.take(`reg:${principal.userId}`);
    if (!challenge)
      throw new BadRequestError(
        "challenge_expired",
        "The fingerprint set-up timed out. Start again.",
      );
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: env.WEBAUTHN_ORIGIN,
        expectedRPID: env.WEBAUTHN_RP_ID,
        requireUserVerification: true,
      });
    } catch (error) {
      throw new BadRequestError(
        "registration_failed",
        error instanceof Error ? error.message : "Registration failed",
      );
    }
    if (!verification.verified)
      throw new BadRequestError("registration_failed", "Registration failed");
    const { credential } = verification.registrationInfo;
    await this.prisma.passkeyCredential.create({
      data: {
        id: credential.id,
        userId: principal.userId,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
        deviceLabel: deviceLabel.trim().slice(0, 60) || "This device",
      },
    });
    await this.audit.record({
      userId: principal.userId,
      loginId: principal.loginId,
      astronautId: principal.astronautId,
      action: "passkey_registered",
      success: true,
      ip: ctx.ip,
      detail: { deviceLabel },
    });
  }

  async loginOptions(loginId: string) {
    const user = await this.prisma.user.findUnique({
      where: { loginId: loginId.trim() },
      include: { credentials: true },
    });
    if (!user || user.disabled || user.credentials.length === 0)
      throw new NotFoundError(
        "no_passkey",
        "Fingerprint sign-in is not set up for this crew ID. Use your passcode.",
      );
    const options = await generateAuthenticationOptions({
      rpID: env.WEBAUTHN_RP_ID,
      userVerification: "required",
      allowCredentials: user.credentials.map((credential) => ({
        id: credential.id,
        transports: credential.transports as AuthenticatorTransport[],
      })),
    });
    this.remember(`auth:${user.loginId}`, options.challenge);
    return options;
  }

  async verifyLogin(
    loginId: string,
    response: AuthenticationResponseJSON,
    ctx: RequestContext,
  ) {
    const fail = async (reason: string) => {
      await this.audit.record({
        loginId,
        action: "login_biometric",
        success: false,
        ip: ctx.ip,
        detail: { reason },
      });
      return new UnauthorizedError(
        "biometric_failed",
        "Fingerprint could not be verified.",
      );
    };
    const challenge = this.take(`auth:${loginId.trim()}`);
    const user = await this.prisma.user.findUnique({
      where: { loginId: loginId.trim() },
      include: { credentials: true },
    });
    if (!challenge || !user || user.disabled) throw await fail("no_challenge_or_user");
    const credential = user.credentials.find((item) => item.id === response.id);
    if (!credential) throw await fail("unknown_credential");

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: env.WEBAUTHN_ORIGIN,
        expectedRPID: env.WEBAUTHN_RP_ID,
        requireUserVerification: true,
        credential: {
          id: credential.id,
          publicKey: new Uint8Array(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports as AuthenticatorTransport[],
        },
      });
    } catch {
      throw await fail("verification_error");
    }
    if (!verification.verified) throw await fail("not_verified");

    await this.prisma.passkeyCredential.update({
      where: { id: credential.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });
    return this.auth.createSession(user, "biometric", ctx);
  }

  list(userId: string) {
    return this.prisma.passkeyCredential.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, deviceLabel: true, createdAt: true, lastUsedAt: true },
    });
  }

  async remove(principal: AuthPrincipal, credentialId: string) {
    const result = await this.prisma.passkeyCredential.deleteMany({
      where: { id: credentialId, userId: principal.userId },
    });
    if (result.count === 0)
      throw new NotFoundError("passkey_not_found", "No such fingerprint registration");
    await this.audit.record({
      userId: principal.userId,
      loginId: principal.loginId,
      astronautId: principal.astronautId,
      action: "passkey_removed",
      success: true,
    });
  }

  private remember(key: string, challenge: string) {
    this.challenges.set(key, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  }

  private take(key: string): string | null {
    const pending = this.challenges.get(key);
    this.challenges.delete(key);
    return pending && pending.expiresAt > Date.now() ? pending.challenge : null;
  }
}
