import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createAstronaut, prisma, resetDatabase, admin } from "../helpers/db";

const app = createApp();

function record(overrides: Record<string, unknown> = {}) {
  return {
    timestamp_utc: "2026-10-21T11:00:00Z",
    astronaut_id: "A01",
    session_id: "A01-D14",
    source: "mock",
    in_flight: true,
    activity_level: "low",
    resp_rate_bpm: 15.2,
    spo2_pct: 98,
    sbp_mmhg: 108,
    dbp_mmhg: 66,
    glucose_mgdl: null,
    fasting: false,
    signal_quality: "OK",
    mission_day: 14,
    ...overrides,
  };
}

const at = (minute: number) =>
  new Date(Date.parse("2026-10-21T11:00:00Z") + minute * 60_000).toISOString();

beforeEach(async () => {
  await resetDatabase();
  await createAstronaut("A01");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/readings", () => {
  it("stores a reading and returns its status", async () => {
    const res = await admin(app).post("/api/readings").send(record());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      stored: true,
      signal_quality: "OK",
      status: "NORMAL",
    });
    expect(await prisma.reading.count()).toBe(1);
  });

  it("ignores a duplicate timestamp + astronaut + source", async () => {
    await admin(app).post("/api/readings").send(record());
    const res = await admin(app)
      .post("/api/readings")
      .send(record({ resp_rate_bpm: 30 }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ stored: false, duplicate: true });
    expect(await prisma.reading.count()).toBe(1);
  });

  it("accepts the same timestamp from a different source", async () => {
    await admin(app).post("/api/readings").send(record());
    const res = await admin(app)
      .post("/api/readings")
      .send(
        record({
          source: "glucose_sensor",
          resp_rate_bpm: null,
          spo2_pct: null,
          sbp_mmhg: null,
          dbp_mmhg: null,
          glucose_mgdl: 88,
        }),
      );
    expect(res.status).toBe(201);
  });

  it("stores implausible values as ARTIFACT without a status", async () => {
    const res = await admin(app)
      .post("/api/readings")
      .send(record({ spo2_pct: 104 }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      signal_quality: "ARTIFACT",
      status: null,
    });
    const stored = await prisma.reading.findFirstOrThrow();
    expect(stored.status).toBeNull();
  });

  it("escalates RR at rest to ATTENTION across separate requests", async () => {
    const statuses: string[] = [];
    for (let minute = 0; minute <= 30; minute += 5) {
      const res = await admin(app)
        .post("/api/readings")
        .send(record({ timestamp_utc: at(minute), resp_rate_bpm: 23 }));
      statuses.push(res.body.status);
    }
    expect(statuses.at(0)).toBe("WATCH");
    expect(statuses.at(-1)).toBe("ATTENTION");
    const latest = await prisma.reading.findFirstOrThrow({
      orderBy: { timestampUtc: "desc" },
    });
    expect(latest.explanation).toContain(
      "has stayed in the WATCH range for 30 min",
    );
  });

  it("logs a gap in the stream as no data, not as a health event", async () => {
    await admin(app)
      .post("/api/readings")
      .send(record({ timestamp_utc: at(0) }));
    const res = await admin(app)
      .post("/api/readings")
      .send(record({ timestamp_utc: at(45) }));
    expect(res.body.status).toBe("NORMAL");
    const gaps = await prisma.dataGap.findMany();
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.minutes).toBe(45);
  });

  it("rejects an invalid record with field details", async () => {
    const res = await admin(app)
      .post("/api/readings")
      .send(record({ activity_level: "sprinting" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_failed");
    expect(res.body.details[0].field).toBe("activity_level");
  });

  it("rejects a record with no measurements", async () => {
    const res = await admin(app)
      .post("/api/readings")
      .send(
        record({
          resp_rate_bpm: null,
          spo2_pct: null,
          sbp_mmhg: null,
          dbp_mmhg: null,
        }),
      );
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown astronaut", async () => {
    const res = await admin(app)
      .post("/api/readings")
      .send(record({ astronaut_id: "A99" }));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("astronaut_not_found");
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await admin(app)
      .post("/api/readings")
      .set("content-type", "application/json")
      .send("{oops");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_json");
  });
});
