import type { PrismaClient } from "generated/prisma/client";

export interface AuditEntry {
  userId?: string | null;
  loginId?: string | null;
  astronautId?: string | null;
  action: string;
  success: boolean;
  ip?: string | null;
  detail?: Record<string, unknown>;
}

// Who signed in, who looked at whose data, who was refused. Never throws: a failed log must not break a request.
export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          loginId: entry.loginId ?? null,
          astronautId: entry.astronautId ?? null,
          action: entry.action,
          success: entry.success,
          ip: entry.ip ?? null,
          ...(entry.detail ? { detail: entry.detail as object } : {}),
        },
      });
    } catch (error) {
      console.error("audit log write failed", error);
    }
  }

  recentForUser(userId: string, limit = 20) {
    return this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { at: "desc" },
      take: limit,
    });
  }

  recentForAstronaut(astronautId: string, limit = 50) {
    return this.prisma.auditLog.findMany({
      where: { astronautId },
      orderBy: { at: "desc" },
      take: limit,
    });
  }
}
