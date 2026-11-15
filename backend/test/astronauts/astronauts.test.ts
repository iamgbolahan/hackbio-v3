import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { prisma, resetDatabase, admin } from "../helpers/db";

const app = createApp();
const MOCK = join(__dirname, "../../data/mock");

const upload = (type: string, file: string) =>
  admin(app)
    .post(`/api/upload?type=${type}`)
    .set("content-type", "text/csv")
    .send(readFileSync(join(MOCK, file), "utf8"));

beforeAll(async () => {
  await resetDatabase();
  await upload("profiles", "mock_astronaut_profiles.csv");
  await upload("baseline", "mock_baseline_sessions.csv");
  await upload("ultrasound", "mock_ultrasound_measurements.csv");
  await upload("stream", "mock_realtime_stream.csv");
  // A02 gets one reading stamped "now" so its Bio-Monitor counts as connected; A01's data ends on 2026-11-06.
  await admin(app).post("/api/readings").send({
    timestamp_utc: new Date().toISOString(),
    astronaut_id: "A02",
    session_id: "A02-LIVE",
    source: "bio_monitor",
    in_flight: true,
    activity_level: "moderate",
    resp_rate_bpm: 16,
    spo2_pct: 90,
    sbp_mmhg: 108,
    dbp_mmhg: 68,
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/astronauts", () => {
  it("lists the uploaded astronauts", async () => {
    const res = await admin(app).get("/api/astronauts");
    expect(res.status).toBe(200);
    expect(res.body.map((a: { astronautId: string }) => a.astronautId)).toEqual(
      ["A01", "A02"],
    );
  });
});

describe("GET /api/profile/:astronautId", () => {
  it("returns identity, baseline and device badges", async () => {
    const res = await admin(app).get("/api/profile/A01");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      astronautId: "A01",
      displayName: "Crew Member 01",
      crewNumber: "01",
      sex: "M",
      baselineStatus: { state: "approved" },
      deviceStatus: { state: "disconnected" },
    });
  });

  it("shows a live device as linked", async () => {
    const res = await admin(app).get("/api/profile/A02");
    expect(res.body.deviceStatus).toEqual({
      state: "connected",
      label: "Bio-Monitor linked",
    });
  });

  it("returns 404 for an unknown astronaut", async () => {
    const res = await admin(app).get("/api/profile/A99");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("astronaut_not_found");
  });
});

describe("GET /api/baseline/:astronautId", () => {
  it("returns the normal-Earth reference in the shape profile.js reads", async () => {
    const res = await admin(app).get("/api/baseline/A01");
    expect(res.status).toBe(200);
    const respiratoryRate = res.body.parameters.respiratoryRate;
    expect(respiratoryRate).toMatchObject({ status: "approved", n: 11 });
    // Answer key: mean 15.085, SD 0.385.
    expect(respiratoryRate.mean).toBeCloseTo(15.085, 1);
    expect(respiratoryRate.standardDeviation).toBeCloseTo(0.385, 1);
    expect(res.body.parameters.bloodPressure.mean.systolicMmHg).toBeCloseTo(
      116.07,
      1,
    );
    expect(res.body.parameters.heartRate).toEqual({ status: "unavailable" });
    expect(res.body.parameters.skinTemperature).toEqual({
      status: "unavailable",
    });
  });

  it("lists every condition and marks a thin one provisional", async () => {
    const res = await admin(app).get("/api/baseline/A02");
    expect(res.body.byCondition).toHaveLength(5);
    const reduced = res.body.byCondition.find(
      (c: { condition: string }) => c.condition === "reduced_pressure",
    );
    expect(reduced.oxygenSaturation.status).toBe("provisional");
    expect(reduced.oxygenSaturation.referenceLabel).toContain(
      "only 5 valid sessions",
    );
  });
});

describe("GET /api/overview/:astronautId", () => {
  it("shows the latest status and readings against the in-flight baseline", async () => {
    const res = await admin(app).get("/api/overview/A01");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      asOf: "2026-11-06T23:55:00.000Z",
      missionDay: 30,
      inFlight: true,
      bioMonitorConnected: false,
      status: {
        level: "NORMAL",
        headline: "No sustained unexplained deviations detected",
      },
      sessionContext: { baselineVerified: true, sessionId: "A01-D30" },
    });
    // In flight the comparison point is the head-down-tilt analog (A01 RR mean 15.27).
    expect(res.body.readings.respiratoryRate.baseline).toBe(15.3);
    expect(res.body.readings.bloodGlucose.unit).toBe("mg/dL");
    expect(res.body.readings.heartRate).toEqual({ status: "unavailable" });
  });

  it("flags low SpO2 immediately on a live reading", async () => {
    const res = await admin(app).get("/api/overview/A02");
    expect(res.body.bioMonitorConnected).toBe(true);
    expect(res.body.status.level).toBe("ATTENTION");
    expect(res.body.status.reasons[0]).toContain(
      "SpO₂ 90% is in the ATTENTION range",
    );
    expect(res.body.readings.oxygenSaturation.status).toBe("ATTENTION");
  });
});

describe("GET /api/connection/:astronautId", () => {
  it("is ready when the baseline is approved and the Bio-Monitor is live", async () => {
    const res = await admin(app).get("/api/connection/A02");
    expect(res.body.steps.map((s: { status: string }) => s.status)).toEqual([
      "verified",
      "verified",
      "connected",
      "ready",
    ]);
    expect(res.body.steps[2].sessionId).toBe("A02-LIVE");
  });

  it("waits for the Bio-Monitor when the latest reading is stale", async () => {
    const res = await admin(app).get("/api/connection/A01");
    expect(res.body.steps[2].status).toBe("waiting");
    expect(res.body.steps[3].status).toBe("blocked");
  });
});

describe("GET /api/events/:astronautId", () => {
  it("lists status changes in the 7 days before the latest reading", async () => {
    const res = await admin(app).get("/api/events/A01");
    expect(res.status).toBe(200);
    // A01 day 25 (2026-11-01) 16:00-16:40: in-flight SBP 95-99.
    const watch = res.body.events.find(
      (e: { timestampUtc: string }) =>
        e.timestampUtc === "2026-11-01T16:00:00.000Z",
    );
    expect(watch).toMatchObject({ from: "NORMAL", to: "WATCH" });
    expect(res.body.events.at(-1).to).toBe("NORMAL");
  });

  it("rejects a window longer than 31 days", async () => {
    const res = await admin(app).get(
      "/api/events/A01?from=2026-09-01T00:00:00Z&to=2026-11-06T00:00:00Z",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("window_too_large");
  });
});
