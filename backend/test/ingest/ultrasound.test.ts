import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createAstronaut, prisma, resetDatabase, admin } from "../helpers/db";

const app = createApp();

function scan(overrides: Record<string, unknown> = {}) {
  return {
    timestamp_utc: "2026-09-06T14:00:00Z",
    astronaut_id: "A01",
    source: "manual_entry",
    in_flight: false,
    condition: "normal_earth",
    mission_day: null,
    ijv_area_mm2: 9.2,
    ijv_flow_grade: 1,
    onsd_mm: 5.2,
    cimt_mm: 0.54,
    lvef_pct: 61,
    muscle_thickness_mm: 22,
    ...overrides,
  };
}

beforeEach(async () => {
  await resetDatabase();
  await createAstronaut("A01");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/ultrasound", () => {
  it("stores a pre-flight scan as NORMAL", async () => {
    const res = await admin(app).post("/api/ultrasound").send(scan());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      stored: true,
      status: "NORMAL",
      muscle_loss_pct: 0,
    });
  });

  it("judges an in-flight scan against the stored pre-flight scans", async () => {
    await admin(app).post("/api/ultrasound").send(scan());
    const res = await admin(app)
      .post("/api/ultrasound")
      .send(
        scan({
          timestamp_utc: "2026-11-06T14:00:00Z",
          in_flight: true,
          condition: "spaceflight",
          mission_day: 30,
          ijv_area_mm2: 80,
          ijv_flow_grade: 3,
          onsd_mm: 6.95,
          muscle_thickness_mm: 21.12,
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("WATCH");
    expect(res.body.muscle_loss_pct).toBe(4);
    expect(res.body.explanation).toContain("ONSD 6.95 mm exceeds");
  });

  it("returns 409 for a second scan at the same time", async () => {
    await admin(app).post("/api/ultrasound").send(scan());
    const res = await admin(app).post("/api/ultrasound").send(scan());
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("scan_already_exists");
  });

  it("rejects values outside plausible ranges", async () => {
    const res = await admin(app)
      .post("/api/ultrasound")
      .send(scan({ ijv_flow_grade: 5 }));
    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe("ijv_flow_grade");
  });

  it("returns 404 for an unknown astronaut", async () => {
    const res = await admin(app)
      .post("/api/ultrasound")
      .send(scan({ astronaut_id: "A99" }));
    expect(res.status).toBe(404);
  });
});
