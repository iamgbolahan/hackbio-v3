import { createHash } from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import { prisma } from "../../src/db/prisma";
import { resetDatabase as reset } from "../../src/db/reset";

export const ADMIN_TOKEN = "test-admin-session-token";

// Empties the database, then adds an admin account with a ready session so existing tests can call the API.
export async function resetDatabase(): Promise<void> {
  await reset(prisma);
  const user = await prisma.user.create({
    data: {
      loginId: "ADMIN",
      displayName: "Test Admin",
      role: "admin",
      passcodeHash: "not-used",
    },
  });
  await prisma.authSession.create({
    data: {
      id: createHash("sha256").update(ADMIN_TOKEN).digest("hex"),
      userId: user.id,
      method: "passcode",
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
}

// supertest request that is signed in as the test admin.
export function admin(app: Express) {
  const withAuth = (test: request.Test) =>
    test.set("Cookie", `hb_session=${ADMIN_TOKEN}`).set("X-Requested-With", "hackbio");
  return {
    get: (url: string) => withAuth(request(app).get(url)),
    post: (url: string) => withAuth(request(app).post(url)),
    put: (url: string) => withAuth(request(app).put(url)),
    delete: (url: string) => withAuth(request(app).delete(url)),
  };
}

export async function createAstronaut(
  id = "A01",
  sex: "M" | "F" = "M",
): Promise<void> {
  await prisma.astronaut.create({
    data: {
      id,
      sex,
      launchDay: 8,
      displayName: `Crew Member ${id.slice(1)}`,
      crewNumber: id.slice(1),
    },
  });
}

export { prisma };
