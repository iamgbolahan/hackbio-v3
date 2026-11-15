import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await request(createApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const res = await request(createApp()).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("route_not_found");
  });
});
