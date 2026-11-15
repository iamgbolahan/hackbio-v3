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
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/trends/:astronautId", () => {
  it("returns the last 7 days of daily averages ending on the latest data day", async () => {
    const res = await admin(app).get("/api/trends/A01?period=7");
    expect(res.status).toBe(200);
    expect(res.body.asOf).toBe("2026-11-06");
    expect(res.body.metrics.respiratoryRate.days).toHaveLength(7);
    expect(res.body.metrics.respiratoryRate.days[0]).toMatchObject({
      date: "2026-10-31",
      missionDay: 24,
    });
    expect(res.body.metrics.bloodPressure.days).toHaveLength(7);
    expect(res.body.metrics.heartRate.status).toBe("available");
    expect(res.body.metrics.skinTemperature.status).toBe("available");
  });

  it("returns 30 days for the 30-day view", async () => {
    const res = await admin(app).get("/api/trends/A02?period=30");
    expect(res.body.metrics.oxygenSaturation.days).toHaveLength(30);
    expect(res.body.metrics.bloodGlucose.days).toHaveLength(30);
  });

  it("matches the mean of that day's stored non-artifact readings", async () => {
    const res = await admin(app).get("/api/trends/A01?period=7");
    const day = res.body.metrics.respiratoryRate.days[0];
    const { _avg } = await prisma.reading.aggregate({
      where: {
        astronautId: "A01",
        signalQuality: { not: "ARTIFACT" },
        timestampUtc: {
          gte: new Date("2026-10-31T00:00:00Z"),
          lt: new Date("2026-11-01T00:00:00Z"),
        },
      },
      _avg: { respRateBpm: true },
    });
    expect(day.value).toBeCloseTo(_avg.respRateBpm as number, 1);
  });

  it("keeps artifact values out of the averages", async () => {
    const res = await admin(app).get("/api/trends/A02?period=30");
    const day24 = res.body.metrics.oxygenSaturation.days.find(
      (d: { missionDay: number }) => d.missionDay === 24,
    );
    expect(day24.value).toBeLessThanOrEqual(100);
  });

  it("keeps resting BP daily averages NORMAL and shows the in-flight fall", async () => {
    const res = await admin(app).get("/api/trends/A01?period=30");
    const days = res.body.metrics.bloodPressure.days as {
      missionDay: number;
      systolic: number;
      status: string;
    }[];
    expect(new Set(days.map((d) => d.status))).toEqual(new Set(["NORMAL"]));
    const ground = days.find((d) => d.missionDay === 7)?.systolic as number;
    const flight = days.find((d) => d.missionDay === 20)?.systolic as number;
    expect(ground - flight).toBeGreaterThan(8);
  });

  it("includes every ultrasound scan against the pre-flight ONSD baseline", async () => {
    const res = await admin(app).get("/api/trends/A01?period=7");
    expect(res.body.ultrasound).toHaveLength(9);
    expect(res.body.ultrasound[0].onsdBaselineMm).toBeCloseTo(5.2, 2);
    expect(res.body.ultrasound.at(-1)).toMatchObject({
      missionDay: 30,
      status: "WATCH",
      onsdMm: 6.95,
    });
  });

  it("does not change averages when the same stream is uploaded again", async () => {
    const before = await prisma.dailyAverage.findMany({
      orderBy: [{ astronautId: "asc" }, { date: "asc" }, { parameter: "asc" }],
    });
    await upload("stream", "mock_realtime_stream.csv");
    const after = await prisma.dailyAverage.findMany({
      orderBy: [{ astronautId: "asc" }, { date: "asc" }, { parameter: "asc" }],
    });
    expect(after).toEqual(before);
  });

  it("rejects an unsupported period", async () => {
    const res = await admin(app).get("/api/trends/A01?period=14");
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown astronaut", async () => {
    const res = await admin(app).get("/api/trends/A99?period=7");
    expect(res.status).toBe(404);
  });
});
