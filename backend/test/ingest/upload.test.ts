import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { prisma, resetDatabase, admin } from "../helpers/db";

const app = createApp();
const MOCK = join(__dirname, "../../data/mock");
const mockFile = (name: string) => readFileSync(join(MOCK, name), "utf8");

const upload = (type: string, csv: string) =>
  admin(app)
    .post(`/api/upload?type=${type}`)
    .set("content-type", "text/csv")
    .send(csv);

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/upload", () => {
  it("loads profiles, then baselines and recomputes their statistics", async () => {
    const profiles = await upload(
      "profiles",
      mockFile("mock_astronaut_profiles.csv"),
    );
    expect(profiles.body).toMatchObject({
      type: "profiles",
      rows: 2,
      stored: 2,
      errors: 0,
    });

    const baseline = await upload(
      "baseline",
      mockFile("mock_baseline_sessions.csv"),
    );
    expect(baseline.status).toBe(200);
    expect(baseline.body).toMatchObject({ rows: 120, stored: 120, errors: 0 });
    expect(await prisma.baselineStat.count()).toBe(40);
    const provisional = await prisma.baselineStat.findMany({
      where: { provisional: true },
    });
    expect(
      new Set(provisional.map((s) => `${s.astronautId}|${s.testCondition}`)),
    ).toEqual(new Set(["A02|reduced_pressure"]));
  });

  it("re-uploading baselines is idempotent", async () => {
    await upload("profiles", mockFile("mock_astronaut_profiles.csv"));
    await upload("baseline", mockFile("mock_baseline_sessions.csv"));
    await upload("baseline", mockFile("mock_baseline_sessions.csv"));
    expect(await prisma.baselineSession.count()).toBe(120);
    expect(await prisma.baselineStat.count()).toBe(40);
  });

  it("loads ultrasound scans and flags the labelled ones", async () => {
    await upload("profiles", mockFile("mock_astronaut_profiles.csv"));
    const res = await upload(
      "ultrasound",
      mockFile("mock_ultrasound_measurements.csv"),
    );
    expect(res.body).toMatchObject({ rows: 18, stored: 18, errors: 0 });
    const flagged = await prisma.ultrasoundScan.findMany({
      where: { status: { not: "NORMAL" } },
    });
    expect(flagged.map((s) => s.scenarioTag).sort()).toEqual([
      "ijv_grade3_onsd_rise_watch",
      "ijv_grade3_watch",
    ]);
  });

  it("loads the full stream, marks artifacts and ignores a second upload as duplicates", async () => {
    await upload("profiles", mockFile("mock_astronaut_profiles.csv"));
    await upload("baseline", mockFile("mock_baseline_sessions.csv"));
    const first = await upload("stream", mockFile("mock_realtime_stream.csv"));
    expect(first.body).toMatchObject({
      rows: 17218,
      stored: 17218,
      duplicates: 0,
      artifacts: 6,
      errors: 0,
    });

    const attention = await prisma.reading.count({
      where: { status: "ATTENTION", scenarioTag: null },
    });
    expect(attention).toBe(0);
    expect(await prisma.dataGap.count()).toBeGreaterThan(0);

    const second = await upload("stream", mockFile("mock_realtime_stream.csv"));
    expect(second.body).toMatchObject({ stored: 0, duplicates: 17218 });
  });

  it("reports bad rows with their line numbers and stores the rest", async () => {
    await upload("profiles", "astronaut_id,sex,launch_day\nA01,M,8\n");
    const csv = [
      "timestamp_utc,astronaut_id,session_id,source,in_flight,activity_level,resp_rate_bpm,spo2_pct,sbp_mmhg,dbp_mmhg",
      "2026-10-15T00:00:00Z,A01,A01-D08,mock,true,low,15,98,108,66",
      "2026-10-15T00:05:00Z,A01,A01-D08,mock,true,jogging,15,98,108,66",
      "2026-10-15T00:10:00Z,A99,A99-D08,mock,true,low,15,98,108,66",
    ].join("\n");
    const res = await upload("stream", csv);
    expect(res.body).toMatchObject({ rows: 3, stored: 1, errors: 2 });
    expect(res.body.error_rows.map((e: { line: number }) => e.line)).toEqual([
      3, 4,
    ]);
    expect(res.body.error_rows[0].message).toContain("activity_level");
  });

  it("rejects an unknown type", async () => {
    const res = await upload("sleep", "a,b\n1,2\n");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_failed");
  });

  it("rejects a file missing required columns", async () => {
    const res = await upload("profiles", "astronaut_id,sex\nA01,M\n");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_columns");
  });

  it("rejects a non-CSV body", async () => {
    const res = await admin(app)
      .post("/api/upload?type=profiles")
      .send({ rows: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("expected_csv");
  });
});
