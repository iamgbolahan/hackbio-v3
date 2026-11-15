import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { hashSecret } from "../../src/modules/auth/helpers/password";
import { createAstronaut, prisma, resetDatabase } from "../helpers/db";

const app = createApp();
const H = { "X-Requested-With": "hackbio" };
const PASS = "Orbit-Pass-2026";

async function account(loginId: string, astronautId: string | null, role = "astronaut") {
  await prisma.user.create({
    data: { loginId, displayName: loginId, role: role as never, astronautId, passcodeHash: await hashSecret(PASS) },
  });
}

async function signIn(loginId: string) {
  const res = await request(app).post("/api/auth/login").set(H).send({ loginId, passcode: PASS });
  expect(res.status).toBe(200);
  return (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]!).join("; ");
}

beforeEach(async () => {
  await resetDatabase();
  await createAstronaut("A01");
  await createAstronaut("A02");
  await account("A01", "A01");
  await account("A02", "A02");
  await account("FS01", null, "flight_surgeon");
});
afterAll(() => prisma.$disconnect());

describe("sign in", () => {
  it("rejects wrong passcode and unknown id with the same answer", async () => {
    const a = await request(app).post("/api/auth/login").set(H).send({ loginId: "A01", passcode: "wrong-pass-1" });
    const b = await request(app).post("/api/auth/login").set(H).send({ loginId: "ZZZ", passcode: "wrong-pass-1" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it("sets an httpOnly cookie and never returns the passcode hash", async () => {
    const res = await request(app).post("/api/auth/login").set(H).send({ loginId: "A01", passcode: PASS });
    expect(res.headers["set-cookie"]![0]).toMatch(/HttpOnly/i);
    expect(JSON.stringify(res.body)).not.toMatch(/scrypt|passcodeHash/);
  });

  it("locks the account after repeated failures", async () => {
    for (let i = 0; i < 5; i++)
      await request(app).post("/api/auth/login").set(H).send({ loginId: "A02", passcode: "wrong-pass-1" });
    const res = await request(app).post("/api/auth/login").set(H).send({ loginId: "A02", passcode: PASS });
    expect(res.status).toBe(429);
  });

  it("requires the anti-forgery header on cookie-carrying writes and refuses foreign origins", async () => {
    const cookie = await signIn("A01");
    expect((await request(app).post("/api/auth/logout").set("Cookie", cookie)).status).toBe(403);
    const foreign = await request(app).post("/api/auth/login").set(H).set("Origin", "https://evil.example").send({ loginId: "A01", passcode: PASS });
    expect(foreign.status).toBe(403);
  });
});

describe("data belongs to the signed-in astronaut", () => {
  it("blocks anonymous access", async () => {
    expect((await request(app).get("/api/overview/A01").set(H)).status).toBe(401);
  });

  it("lets an astronaut read their own record only", async () => {
    const cookie = await signIn("A01");
    expect((await request(app).get("/api/profile/A01").set(H).set("Cookie", cookie)).status).toBe(200);
    expect((await request(app).get("/api/profile/A02").set(H).set("Cookie", cookie)).status).toBe(403);
    expect((await request(app).get("/api/trends/A02?days=7").set(H).set("Cookie", cookie)).status).toBe(403);
    expect((await request(app).get("/api/stream/A02").set(H).set("Cookie", cookie)).status).toBe(403);
  });

  it("keeps the astronaut list for staff", async () => {
    const crew = await signIn("A01");
    const fs = await signIn("FS01");
    expect((await request(app).get("/api/astronauts").set(H).set("Cookie", crew)).status).toBe(403);
    expect((await request(app).get("/api/astronauts").set(H).set("Cookie", fs)).status).toBe(200);
    expect((await request(app).get("/api/profile/A02").set(H).set("Cookie", fs)).status).toBe(200);
  });

  it("does not let an astronaut write readings", async () => {
    const cookie = await signIn("A01");
    const res = await request(app).post("/api/readings").set(H).set("Cookie", cookie).send({});
    expect(res.status).toBe(403);
  });

  it("ends the session on logout", async () => {
    const cookie = await signIn("A01");
    await request(app).post("/api/auth/logout").set(H).set("Cookie", cookie);
    expect((await request(app).get("/api/auth/me").set(H).set("Cookie", cookie)).status).toBe(401);
  });
});

describe("Bio-Monitor verification", () => {
  beforeEach(async () => {
    await prisma.bioMonitorDevice.create({
      data: { deviceId: "BM-A01", astronautId: "A01", pairingHash: await hashSecret("A01-PAIR-1"), label: "BM" },
    });
  });

  it("opens a session only with the astronaut's own pairing code", async () => {
    const a1 = await signIn("A01");
    const a2 = await signIn("A02");
    expect((await request(app).post("/api/auth/monitor/verify").set(H).set("Cookie", a2).send({ pairingCode: "A01-PAIR-1" })).status).toBe(400);
    const ok = await request(app).post("/api/auth/monitor/verify").set(H).set("Cookie", a1).send({ pairingCode: "a01-pair-1" });
    expect(ok.status).toBe(201);
    expect(ok.body.monitor.sessionId).toMatch(/^A01-D\d{2}/);
  });

  it("rejects device posts without the device key or an open session", async () => {
    const res = await request(app).post("/api/readings").set(H).send({});
    expect([401, 403]).toContain(res.status);
  });
});
