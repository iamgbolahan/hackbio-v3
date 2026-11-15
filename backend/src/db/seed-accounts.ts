import { hashSecret } from "../modules/auth/helpers/password";
import { prisma } from "./prisma";

// Demo values matching the dashboard design; the mock profiles only carry id, sex and launch day.
export const DEMO_PROFILES: Record<string, { displayName: string; missionName: string }> = {
  A01: { displayName: "Mariam", missionName: "Artemis" },
  A02: { displayName: "Crew Member 02", missionName: "Artemis" },
};

// Demo accounts. Change these before any real use.
export const ACCOUNTS = [
  { loginId: "A01", displayName: "Mariam", role: "astronaut", astronautId: "A01", passcode: "Artemis-A01-2026", device: { deviceId: "BM-A01", pairing: "A01-PAIR-7391" } },
  { loginId: "A02", displayName: "Crew Member 02", role: "astronaut", astronautId: "A02", passcode: "Artemis-A02-2026", device: { deviceId: "BM-A02", pairing: "A02-PAIR-5528" } },
  { loginId: "FS01", displayName: "Flight Surgeon", role: "flight_surgeon", astronautId: null, passcode: "Surgeon-FS01-2026", device: null },
  { loginId: "ADMIN", displayName: "Mission Admin", role: "admin", astronautId: null, passcode: "Admin-Console-2026", device: null },
] as const;

export async function seedProfilesAndAccounts(): Promise<void> {
  for (const [id, profile] of Object.entries(DEMO_PROFILES))
    await prisma.astronaut.updateMany({ where: { id }, data: profile });
  for (const a of ACCOUNTS) {
    const passcodeHash = await hashSecret(a.passcode);
    await prisma.user.upsert({
      where: { loginId: a.loginId },
      update: { passcodeHash, failedAttempts: 0, lockedUntil: null, disabled: false },
      create: { loginId: a.loginId, displayName: a.displayName, role: a.role, astronautId: a.astronautId, passcodeHash },
    });
    if (a.device) {
      const pairingHash = await hashSecret(a.device.pairing.toUpperCase());
      await prisma.bioMonitorDevice.upsert({
        where: { deviceId: a.device.deviceId },
        update: { pairingHash, active: true },
        create: { deviceId: a.device.deviceId, astronautId: a.astronautId, pairingHash, label: `Bio-Monitor ${a.device.deviceId}` },
      });
    }
  }
}
