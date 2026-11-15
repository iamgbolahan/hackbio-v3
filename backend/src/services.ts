import { env } from "./config/env";
import { statusEngineConfig } from "./config/status-engine";
import { prisma } from "./db/prisma";
import { AstronautProfileService } from "./modules/astronauts/services/astronaut-profile.service";
import { ConnectionService } from "./modules/astronauts/services/connection.service";
import { MonitoringSessionService } from "./modules/astronauts/services/monitoring-session.service";
import { OverviewService } from "./modules/astronauts/services/overview.service";
import { AuditService } from "./modules/auth/services/audit.service";
import { AuthService } from "./modules/auth/services/auth.service";
import { MonitorVerificationService } from "./modules/auth/services/monitor-verification.service";
import { WebAuthnService } from "./modules/auth/services/webauthn.service";
import { SimulatorService } from "./modules/simulator/simulator.service";
import { StreamService } from "./modules/astronauts/services/stream.service";
import { StatusEventsService } from "./modules/astronauts/services/status-events.service";
import { BaselineStatsService } from "./modules/baselines/services/baseline-stats.service";
import { CsvUploadService } from "./modules/ingest/services/csv-upload.service";
import { ReadingIngestService } from "./modules/ingest/services/reading-ingest.service";
import { UltrasoundIngestService } from "./modules/ingest/services/ultrasound-ingest.service";
import { ReadingEvaluator } from "./modules/status/services/reading-evaluator";
import { DailyAveragesService } from "./modules/trends/services/daily-averages.service";
import { TrendsService } from "./modules/trends/services/trends.service";

export interface Services {
  readingIngest: ReadingIngestService;
  ultrasoundIngest: UltrasoundIngestService;
  csvUpload: CsvUploadService;
  trends: TrendsService;
  profiles: AstronautProfileService;
  overview: OverviewService;
  connection: ConnectionService;
  statusEvents: StatusEventsService;
  stream: StreamService;
  audit: AuditService;
  auth: AuthService;
  webauthn: WebAuthnService;
  monitor: MonitorVerificationService;
  simulator: SimulatorService;
}

// The one place services are wired together, shared by the HTTP app and the scripts.
export function createServices(): Services {
  const baselineStats = new BaselineStatsService(prisma);
  const dailyAverages = new DailyAveragesService(prisma);
  const monitoringSession = new MonitoringSessionService(
    prisma,
    env.CONNECTED_WITHIN_MIN,
  );
  const readingIngest = new ReadingIngestService({
    prisma,
    evaluator: new ReadingEvaluator(statusEngineConfig),
    baselineStats,
    dailyAverages,
    gapMinutes: statusEngineConfig.gapMinutes,
  });
  const ultrasoundIngest = new UltrasoundIngestService(prisma);

  const audit = new AuditService(prisma);
  const auth = new AuthService(prisma, audit);

  return {
    audit,
    auth,
    webauthn: new WebAuthnService(prisma, auth, audit),
    monitor: new MonitorVerificationService(prisma, audit),
    simulator: new SimulatorService(prisma, baselineStats, readingIngest),
    stream: new StreamService(prisma),
    readingIngest,
    ultrasoundIngest,
    csvUpload: new CsvUploadService(
      prisma,
      readingIngest,
      ultrasoundIngest,
      baselineStats,
    ),
    trends: new TrendsService(prisma, dailyAverages),
    profiles: new AstronautProfileService(prisma, monitoringSession),
    overview: new OverviewService(prisma, baselineStats, monitoringSession),
    connection: new ConnectionService(prisma, baselineStats, monitoringSession),
    statusEvents: new StatusEventsService(prisma),
  };
}
