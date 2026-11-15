import { resolve } from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { backfillMissingHistory, bootstrap } from "./bootstrap";
import { env } from "./config/env";
import { errorHandler, notFoundRoute } from "./middleware/error-handler";
import { astronautsRouter } from "./modules/astronauts/controllers/astronauts.controller";
import {
  attachAuth,
  csrfGuard,
  ingestGuard,
  requireAstronautAccess,
  requireAuth,
  requireRole,
} from "./modules/auth/auth.middleware";
import { authRouter } from "./modules/auth/controllers/auth.controller";
import { readingsRouter } from "./modules/ingest/controllers/readings.controller";
import { ultrasoundRouter } from "./modules/ingest/controllers/ultrasound.controller";
import { uploadRouter } from "./modules/ingest/controllers/upload.controller";
import { setupRouter } from "./modules/setup/setup.controller";
import { trendsRouter } from "./modules/trends/controllers/trends.controller";
import { createServices, type Services } from "./services";

export function createApp(services: Services = createServices()): express.Express {
  const app = express();
  app.set("trust proxy", 1);
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.text({ type: ["text/csv", "text/plain"], limit: "30mb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Hosts with no shell: the first request to the API prepares the database (tables, demo accounts, past days).
  // Every step skips what already exists, so repeating it is harmless. Turn AUTO_SETUP off afterwards.
  if (env.AUTO_SETUP) {
    let ready: Promise<void> | null = null;
    app.use("/api", async (_req, _res, next) => {
      ready ??= bootstrap().then(() => backfillMissingHistory(services));
      try {
        await ready;
        next();
      } catch (error) {
        ready = null;
        next(error);
      }
    });
  }

  app.use("/api", setupRouter(services));

  // No background timer on a serverless host: bring the stream up to date whenever a signed-in page asks for data.
  if (env.SIM_LAZY) {
    let lastTick = 0;
    app.use(["/api/stream", "/api/overview", "/api/trends", "/api/connection", "/api/events"], async (_req, _res, next) => {
      if (Date.now() - lastTick > 4000) {
        lastTick = Date.now();
        await services.simulator.tick();
      }
      next();
    });
  }

  app.use("/api", attachAuth(services.auth), csrfGuard);
  app.use("/api", authRouter(services));

  // Writing data: an admin, a flight surgeon (ultrasound only), or a Bio-Monitor gateway with the device key.
  app.use("/api/readings", ingestGuard("readings", services.monitor));
  app.use("/api/ultrasound", ingestGuard("ultrasound", services.monitor));
  app.use("/api/upload", ingestGuard("upload", services.monitor));
  app.use("/api", readingsRouter(services.readingIngest));
  app.use("/api", ultrasoundRouter(services.ultrasoundIngest));
  app.use("/api", uploadRouter(services.csvUpload));

  // Reading data: must be signed in, and an astronaut sees only their own record.
  const ownRecord = requireAstronautAccess(services.audit);
  app.use("/api/trends/:astronautId", requireAuth, ownRecord);
  app.use("/api/profile/:astronautId", requireAuth, ownRecord);
  app.use("/api/baseline/:astronautId", requireAuth, ownRecord);
  app.use("/api/overview/:astronautId", requireAuth, ownRecord);
  app.use("/api/connection/:astronautId", requireAuth, ownRecord);
  app.use("/api/events/:astronautId", requireAuth, ownRecord);
  app.use("/api/stream/:astronautId", requireAuth, ownRecord);
  app.use("/api/astronauts", requireRole("flight_surgeon", "admin"));
  app.use("/api", trendsRouter(services.trends));
  app.use("/api", astronautsRouter(services));

  app.use("/api", notFoundRoute);
  if (env.FRONTEND_DIR) {
    app.use(express.static(resolve(process.cwd(), env.FRONTEND_DIR), { index: "login.html" }));
  }
  app.use(notFoundRoute);
  app.use(errorHandler);
  return app;
}
