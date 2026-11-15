# HackBio backend

Backend for the astronaut health-monitoring prototype (NASA Space Apps 2026). It takes Bio-Monitor-style readings, compares each one with the astronaut's own pre-flight baseline and the proposal's threshold table, and returns a **NORMAL / WATCH / ATTENTION** status with a plain-language reason. It also serves the four dashboard screens: Overview, Health Trends, Astronaut Profile and Connection.

Express 4 + TypeScript, Prisma 7 + PostgreSQL, zod for validation, Vitest for tests.

> Everything in `data/mock/` is synthetic. The thresholds are prototype rules transcribed from the proposal, not validated medical limits.

## Quick start

```bash
cp .env.example .env
docker compose up -d          # Postgres on localhost:55440 (dev db + hackbio_test)
npm install
npx prisma generate           # npm 11 may skip the postinstall hook
npm run db:migrate            # apply migrations to the dev db
npm run seed                  # load the mock pack (add -- --reset to empty the db first)
npm run dev                   # http://localhost:3000
```

Then open `http://localhost:3000/api/overview/A01`.

| Script                                  | What it does                                                          |
| --------------------------------------- | --------------------------------------------------------------------- |
| `npm run dev` / `build` / `start`       | Watch mode / compile to `dist/` / run the compiled server             |
| `npm test`                              | All tests (needs Docker Postgres; run `npm run db:test:migrate` once) |
| `npm run seed [-- --reset]`             | Load profiles, baselines, ultrasound and the 17,218-row stream        |
| `npm run replay -- [options]`           | Stream the mock data to `POST /api/readings` like a live sensor       |
| `npm run typecheck` / `lint` / `format` | tsc / eslint / prettier                                               |

Replay options: `--url` (default `http://localhost:3000/api/readings`), `--astronaut A01`, `--from-day 14`, `--limit 20`, `--rate 1` (records per second), `--shift-to-now` (move timestamps to the present so the dashboard shows the session as live) and `--dry-run`.

Example: replay A02's SpO₂ ATTENTION event live with `npm run replay -- --astronaut A02 --from-day 20 --limit 129 --rate 50 --shift-to-now`. The replay stops inside the event, so the dashboard stays on ATTENTION.

## Configuration

| Variable                                                                | Default              | Meaning                                                                         |
| ----------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                          | —                    | Postgres connection string                                                      |
| `PORT`                                                                  | `3000`               |                                                                                 |
| `CORS_ORIGINS`                                                          | empty                | Comma-separated browser origins allowed to call the API                         |
| `PERSISTENCE_RESP_RATE_MIN` / `_SPO2_MIN` / `_SBP_MIN` / `_GLUCOSE_MIN` | 30 / 30 / 60 / empty | Minutes a WATCH value must last before it escalates to ATTENTION; empty = never |
| `BASELINE_Z_LIMIT`                                                      | empty                | Turns on WATCH from the personal-baseline layer; see "Known limitations"        |
| `GAP_MINUTES`                                                           | `10`                 | A longer gap between readings is logged as "no data" and restarts persistence   |
| `CONNECTED_WITHIN_MIN`                                                  | `15`                 | The Bio-Monitor counts as connected if its latest reading is this recent        |

The proposal leaves persistence durations open. These defaults are the ones that reproduce every labelled event in `data/mock/json/expected_events.json`.

## API

**Frontend developers: start with [docs/FRONTEND_CONTRACT.md](docs/FRONTEND_CONTRACT.md).** It maps every screen element to its field and lists every state to handle. The machine-readable spec is [docs/openapi.yaml](docs/openapi.yaml), and real captured responses are in [docs/examples/](docs/examples/).

Ingest bodies use the proposal's snake_case **common record**. Read responses are camelCase and use the metric keys `heartRate`, `respiratoryRate`, `bloodPressure`, `skinTemperature`, `oxygenSaturation` and `bloodGlucose`.

Errors always look like `{ "error": "<code>", "message": "..." }`. Validation failures look like `{ "error": "validation_failed", "details": [{ "field", "message" }] }`.

There is no authentication: the onboard device does the biometric check, and this prototype trusts `astronaut_id`.

### Ingest

**`POST /api/readings`**: one record from the Bio-Monitor, glucose sensor or replay.

```json
{
  "timestamp_utc": "2026-10-21T11:30:00Z",
  "astronaut_id": "A01",
  "session_id": "A01-D14",
  "source": "bio_monitor",
  "in_flight": true,
  "activity_level": "low",
  "resp_rate_bpm": 23.1,
  "spo2_pct": 98,
  "sbp_mmhg": 108,
  "dbp_mmhg": 66,
  "glucose_mgdl": null,
  "fasting": false,
  "signal_quality": "OK",
  "mission_day": 14
}
```

| Status | Body                                                                                      | When                                               |
| ------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `201`  | `{ "stored": true, "signal_quality": "OK", "status": "ATTENTION", "explanation": "..." }` | stored                                             |
| `200`  | `{ "stored": false, "duplicate": true }`                                                  | same timestamp + astronaut + source already stored |
| `400`  | validation error                                                                          | bad field, or no measurement at all                |
| `404`  | `astronaut_not_found`                                                                     | unknown astronaut                                  |

Measurement fields may be `null` ("not measured now"). Values outside plausible limits (for example SpO₂ > 100) are stored with `signal_quality: "ARTIFACT"` and `status: null`, and are never evaluated.

**`POST /api/ultrasound`**: manual entry after a scan. Fields: `timestamp_utc`, `astronaut_id`, `source`, `in_flight`, `condition` (`normal_earth` | `spaceflight`), plus `ijv_area_mm2`, `ijv_flow_grade` (1–4), `onsd_mm`, `cimt_mm`, `lvef_pct` and `muscle_thickness_mm`.

- `201` returns `{ "stored": true, "status": "WATCH", "muscle_loss_pct": 2.94, "explanation": "..." }`.
- `409` means a scan already exists at that time.
- `400` means a value is out of its plausible range.

**`POST /api/upload?type=profiles|baseline|ultrasound|stream`**: body is `text/csv` with the mock files' columns.

- Returns `200 { "type", "rows", "stored", "duplicates", "artifacts", "errors", "error_rows": [{ "line", "message" }] }`.
- Bad rows are reported by file line and the rest are stored.
- Upload `profiles` first. Baseline uploads recompute baseline statistics.

### Dashboard reads

| Endpoint                           | Screen            | Notes                                                                                                                     |
| ---------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/astronauts`              | —                 | `[{ astronautId, displayName, crewNumber, sex, launchDay, missionName }]`                                                 |
| `GET /api/overview/:id`            | Overview          | Latest status + reason, session context, each reading with the baseline it is compared against                            |
| `GET /api/trends/:id?period=7\|30` | Health Trends     | Daily averages per metric (`days: [{ date, missionDay, value, samples }]`), BP with resting status, every ultrasound scan |
| `GET /api/profile/:id`             | Astronaut Profile | Same shape `profile.js` already reads                                                                                     |
| `GET /api/baseline/:id`            | Astronaut Profile | `parameters` = normal-Earth reference cards; `byCondition` = all five test conditions                                     |
| `GET /api/connection/:id`          | Connection        | The four steps: identity, baseline, Bio-Monitor session, monitoring                                                       |
| `GET /api/events/:id?from=&to=`    | —                 | Overall-status changes; default is the 7 days before the latest reading, max 31 days                                      |
| `GET /health`                      | —                 | `{ "ok": true }`                                                                                                          |

All `:id` routes return `404 astronaut_not_found` for an unknown astronaut. `heartRate` and `skinTemperature` always come back as `{ "status": "unavailable" }`, because the proposal and mock data do not include them.

## How a status is decided

Each reading goes through:

1. **Arrival checks**: implausible values are stored as ARTIFACT, duplicates are ignored, and gaps are logged as "no data".
2. **Threshold layer**: the proposal's table (`src/config/thresholds.ts`) with in-flight SBP limits, fasting vs any-time glucose, and integer rounding for NEWS2-style bands.
3. **Activity**: a WATCH-range respiratory rate or BP at moderate or high activity is treated as explained. SpO₂, glucose and ultrasound values never are.
4. **Persistence**: a WATCH that lasts past its configured minutes becomes ATTENTION. An ATTENTION-range value is ATTENTION immediately.
5. **Personal baseline**: z-score and % deviation against the matching baseline. In flight that is the head-down-tilt or dry-immersion baseline, otherwise the Earth baseline adjusted by the population in-flight shift. Conditions with fewer than 6 sessions are provisional and skipped.

The worst parameter decides the overall status.

Ultrasound scans are judged when entered:

- IJV status comes from the flow grade.
- LVEF limits depend on sex.
- Muscle loss is measured against the pre-flight mean.
- In flight, ONSD is WATCH above the pre-flight mean + 0.91 mm.

`test/status/answer-key.test.ts` runs all 17,218 mock rows through the engine. It checks every labelled event, and that every untagged record stays NORMAL.

## Known limitations

- **The baseline layer is informational by default.** Baseline SDs describe how much 5–10-minute _session means_ vary, which is far less than single readings vary. At `BASELINE_Z_LIMIT=3` the layer flags 31% of normal mock readings (18% at 4, 0.6% at 6, none at 8). The mock's in-flight SBP also sits ~6 mmHg below its own head-down-tilt baseline. z and % deviation are still returned on every reading. A rolling resting average compared with the baseline would be the better next step once the baseline data is real.
- **Threshold-table gaps from the proposal:**
  - ONSD 5.7–5.8 mm has no band (treated as NORMAL, and said so in the explanation).
  - Non-fasting glucose 70–199 is treated as NORMAL (mock-pack assumption).
  - DBP has no low limit.
- **Out-of-order readings** are evaluated against the nearest earlier stored reading. Later readings that were already stored are not re-evaluated.
- **Ultrasound order matters**: in-flight scans are judged against the ground scans already stored. CSV upload sorts by time; for manual entry, enter ground scans first.
- **"Connected"** uses the real clock, so the historical mock data shows as disconnected until you run a replay with `--shift-to-now`.
- **No authentication.** The Connection screen's identity step reports this in its `note`.

## Frontend notes

The frontend reads its base URL from `window.BioCosmosX_CONFIG.apiBaseUrl` and the astronaut from `?astronautId=A01`. The mock astronauts are `A01` and `A02`, not `AST-001`.

`health-trends.js` uses hardcoded data keyed `temperature` and `oxygen`. When it switches to `/api/trends`, those become `skinTemperature` and `oxygenSaturation`, and it can add `bloodGlucose`.

## Deploying to Render

`render.yaml` creates the web service and a free Postgres. Migrations run on start. Free Render Postgres databases expire after 30 days.

Once the service is live, load the mock data from your machine through the upload route:

```bash
API=https://hackbio-backend.onrender.com
for pair in profiles:mock_astronaut_profiles baseline:mock_baseline_sessions \
            ultrasound:mock_ultrasound_measurements stream:mock_realtime_stream; do
  curl -sS -X POST -H 'content-type: text/csv' --data-binary @"data/mock/${pair#*:}.csv" \
       "$API/api/upload?type=${pair%%:*}"; echo
done
```

Then run `npm run replay -- --url $API/api/readings --shift-to-now` to make a session live.
