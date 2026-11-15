import { createApp } from "./app";
import { backfillMissingHistory } from "./bootstrap";
import { env } from "./config/env";
import { createServices } from "./services";

const services = createServices();

createApp(services).listen(env.PORT, () => {
  console.log(`hackbio-backend listening on :${env.PORT}`);
  if (env.SIM_ENABLED) {
    services.simulator.start();
    console.log(`simulated Bio-Monitor on: one reading every ${env.SIM_INTERVAL_SEC}s per verified session`);
  }
  if (env.BACKFILL_ON_START)
    backfillMissingHistory(services).catch((error: unknown) => console.error("history backfill failed", error));
});
