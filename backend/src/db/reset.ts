import type { PrismaClient } from "generated/prisma/client";

// Empties every table; used by tests and by `npm run seed -- --reset`.
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "audit_log", "auth_sessions", "passkey_credentials", "users", "monitoring_sessions", "bio_monitor_devices", "readings", "data_gaps", "daily_averages", "ultrasound_scans", "baseline_stats", "baseline_sessions", "astronauts" RESTART IDENTITY CASCADE',
  );
}
