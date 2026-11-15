# HackBio frontend integration contract

How the dashboard ([mariam12452/astronaut-health-monitoring](https://github.com/mariam12452/astronaut-health-monitoring)) talks to this backend. It is written for frontend developers and for coding agents working on that repo. Every JSON example below is a real response captured from the running server.

| File                                    | Use it for                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `docs/FRONTEND_CONTRACT.md` (this file) | What to call from each screen, which element each field fills, every state to handle           |
| [`docs/openapi.yaml`](openapi.yaml)     | Machine-readable spec (OpenAPI 3.1). Import into Postman or Swagger, or generate types         |
| [`docs/examples/`](examples/)           | 26 real request/response pairs, one file per endpoint and state. All validate against the spec |

---

## 0. Rules for agents (read first)

1. **Never invent fields.** Use only fields listed here or in `openapi.yaml`. If a field you need is missing, stop and ask; don't guess a name.
2. **Read responses are camelCase; ingest request bodies are snake_case.** Don't convert one into the other.
3. **`{ "status": "unavailable" }` is a normal value, not an error.** `heartRate` and `skinTemperature` always come back like this (the system does not measure them). Render "Not measured", never `undefined` or `NaN`.
4. **`null` means "no data yet"**, for example an astronaut with no readings. Render an empty state.
5. **Always read the HTTP status before the body.** Errors are always JSON: `{ "error": "<code>", "message": "..." }`. Validation errors also carry `details[]`.
6. **Statuses are exactly `NORMAL`, `WATCH`, `ATTENTION`.** Map them to tones with the table in §3.4.
7. **Times are UTC ISO 8601 strings.** Format them for display in the browser; don't do date maths on display strings.
8. **The astronaut id comes from `?astronautId=` in the page URL.** The seeded ids are `A01` and `A02`. `AST-001` from the old placeholder does not exist.
9. **The base URL comes from `window.BioCosmosX_CONFIG.apiBaseUrl`.** Never hardcode it in page scripts.
10. **Leave `profile.js` alone.** It already matches this API.

---

## 1. Setup

### 1.1 Base URL

| Environment   | Base URL                               |
| ------------- | -------------------------------------- |
| **Live**      | `https://hackbio-backend.onrender.com` |
| Local backend | `http://localhost:3000`                |

The live server is seeded with the mock data (A01, A02). Quick check: <https://hackbio-backend.onrender.com/health> and <https://hackbio-backend.onrender.com/api/overview/A01>.

Add a small `js/config.js` and load it **before** every page script:

```html
<script src="js/config.js"></script>
<script src="js/navbar.js" defer></script>
<script src="js/health-trends.js" defer></script>
```

```js
// js/config.js
window.BioCosmosX_CONFIG = {
  apiBaseUrl: "https://hackbio-backend.onrender.com", // use "http://localhost:3000" against a local backend
  defaultAstronautId: "A01",
};
```

Free Render services sleep when idle, so the first request after a while can take ~30–60 s. Show the loading state; don't treat a slow response as a failure.

### 1.2 CORS

The backend only answers browser requests from origins listed in its `CORS_ORIGINS` env var. Configured by default:

- `https://final-nasa-hackathon-2.vercel.app`, the live frontend
- `http://localhost:5500`, VS Code Live Server

If you serve the frontend from another origin (e.g. `http://127.0.0.1:5500` or `http://localhost:5173`), ask the backend team to add it. A CORS failure shows in the browser console as "blocked by CORS policy", and `fetch` rejects with a `TypeError`.

### 1.3 Shared fetch helper

Use one helper on every page. It mirrors what `profile.js` already does, but also surfaces the backend's error code:

```js
// js/api.js
const API_BASE = (window.BioCosmosX_CONFIG?.apiBaseUrl || "").replace(
  /\/$/,
  "",
);

function getAstronautId() {
  return (
    new URLSearchParams(location.search).get("astronautId")?.trim() ||
    window.BioCosmosX_CONFIG?.defaultAstronautId ||
    ""
  );
}

class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `API request failed (${status})`);
    this.status = status; // HTTP status, e.g. 404
    this.code = body?.error; // e.g. "astronaut_not_found"
    this.details = body?.details; // validation errors only
  }
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body);
  return body;
}

async function apiPost(path, payload, contentType = "application/json") {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": contentType, Accept: "application/json" },
    body:
      contentType === "application/json" ? JSON.stringify(payload) : payload,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body);
  return { status: response.status, body };
}
```

Always URL-encode the astronaut id: ``apiGet(`/api/overview/${encodeURIComponent(id)}`)``.

---

## 2. Endpoint map

| Screen / use                  | Method & path                                                             | Call when                        | Poll            |
| ----------------------------- | ------------------------------------------------------------------------- | -------------------------------- | --------------- |
| Overview                      | `GET /api/overview/:astronautId`                                          | page load                        | every **30 s**  |
| Health Trends                 | `GET /api/trends/:astronautId?period=7` or `30`                           | page load and on the 7/30 toggle | no (daily data) |
| Astronaut Profile             | `GET /api/profile/:astronautId` + `GET /api/baseline/:astronautId`        | page load and Refresh            | no              |
| Connection                    | `GET /api/connection/:astronautId`                                        | page load                        | every **15 s**  |
| Header "MISSION DAY / CREW"   | `GET /api/overview/:id` (missionDay) + `GET /api/astronauts` (crewNumber) | page load                        | —               |
| Astronaut picker (optional)   | `GET /api/astronauts`                                                     | app start                        | no              |
| Alert timeline (optional)     | `GET /api/events/:astronautId?from=&to=`                                  | on demand                        | no              |
| Ultrasound form (operator)    | `POST /api/ultrasound`                                                    | submit                           | —               |
| CSV upload (operator)         | `POST /api/upload?type=...`                                               | submit                           | —               |
| Sensor feed (not the browser) | `POST /api/readings`                                                      | per reading                      | —               |
| Health check                  | `GET /health`                                                             | optional                         | —               |

Pause polling when the tab is hidden (`document.visibilityState === "hidden"`), and resume on `visibilitychange`.

---

## 3. Shared concepts

### 3.1 Metric keys

The same six keys appear in every read response and match the frontend's `data-metric` attributes:

| Key                | Measured? | Unit        | Notes                                                                           |
| ------------------ | --------- | ----------- | ------------------------------------------------------------------------------- |
| `respiratoryRate`  | yes       | breaths/min |                                                                                 |
| `oxygenSaturation` | yes       | %           | Health Trends currently calls this `oxygen`; rename it                          |
| `bloodPressure`    | yes       | mmHg        | systolic and diastolic pair                                                     |
| `bloodGlucose`     | yes       | mg/dL       | **new**: no card exists yet; add one (see §5.2)                                 |
| `heartRate`        | **no**    | —           | always `{ "status": "unavailable" }`                                            |
| `skinTemperature`  | **no**    | —           | always unavailable. Health Trends currently calls this `temperature`; rename it |

### 3.2 Astronauts in the seeded data

| id    | displayName    | crewNumber | sex | What it is good for                                                                         |
| ----- | -------------- | ---------- | --- | ------------------------------------------------------------------------------------------- |
| `A01` | Mariam         | 01         | M   | Historical data only (ends 2026-11-06) → Bio-Monitor shows **disconnected**                 |
| `A02` | Crew Member 02 | 02         | F   | Has the provisional `reduced_pressure` baseline. Use the replay script (§9) to make it live |

### 3.3 Mission timeline

Mission day 1 is 2026-10-08 (UTC). Days 1–7 are on the ground and days 8–30 are in flight (`launchDay = 8`). `inFlight` tells you which applies to a reading. Format the mission day with three digits in the header, e.g. `String(missionDay).padStart(3, "0")` → `030`.

### 3.4 Status → UI tone

Pills use `data-tone` (see `css/components.css`). The CSS has no red tone yet, so add one:

```css
.pill[data-tone="danger"] {
  background: #fdecec;
  color: #a32020;
}
```

| Value                    | Meaning                                                | `data-tone`          | Suggested text         |
| ------------------------ | ------------------------------------------------------ | -------------------- | ---------------------- |
| `NORMAL`                 | Within range, or explained by activity                 | _(default: success)_ | NORMAL                 |
| `WATCH`                  | In the WATCH range, or a deviation being monitored     | `warning`            | WATCH                  |
| `ATTENTION`              | ATTENTION range, or a WATCH that persisted unexplained | `danger`             | ATTENTION              |
| `"unavailable"` / `null` | Not measured, or no data                               | `neutral`            | Not measured / No data |

### 3.5 Errors

| HTTP | `error` code                                       | Where                    | What the UI should do                                                                        |
| ---- | -------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| 400  | `validation_failed` (+ `details[]`)                | any bad query/body       | Forms: show `details[i].message` next to field `details[i].field`. Reads: it's a bug; log it |
| 400  | `window_too_large`                                 | events                   | Narrow the date range (max 31 days)                                                          |
| 400  | `expected_csv` / `invalid_csv` / `missing_columns` | upload                   | Show the message to the operator                                                             |
| 400  | `invalid_json`                                     | ingest                   | Bug in the request; log it                                                                   |
| 404  | `astronaut_not_found`                              | any `:astronautId` route | "No astronaut with id X". Offer the picker / `?astronautId=A01`                              |
| 404  | `route_not_found`                                  | wrong path               | Bug; log it                                                                                  |
| 409  | `scan_already_exists`                              | ultrasound               | "A scan already exists at this time"                                                         |
| 500  | `internal_error`                                   | anywhere                 | "Service problem, try again" plus a retry button                                             |
| —    | network `TypeError`                                | anywhere                 | Backend down, asleep or CORS. Show an offline state and retry with backoff                   |

Example (`docs/examples/readings-post-validation-error.json`):

```json
{
  "error": "validation_failed",
  "details": [
    {
      "field": "source",
      "message": "Invalid enum value. Expected 'bio_monitor' | 'glucose_sensor' | 'manual_entry' | 'mock', received 'fitbit'"
    },
    {
      "field": "activity_level",
      "message": "Invalid enum value. Expected 'low' | 'moderate' | 'high', received 'jogging'"
    }
  ]
}
```

---

## 4. Overview screen (`index.html`)

`GET /api/overview/:astronautId`, polled every 30 s.

### 4.1 Response (A02 with a live low-SpO₂ reading, `examples/overview-A02-live-attention.json`)

```json
{
  "astronautId": "A02",
  "asOf": "2026-11-14T22:10:00.000Z",
  "missionDay": 38,
  "inFlight": true,
  "bioMonitorConnected": true,
  "status": {
    "level": "ATTENTION",
    "headline": "A value needs attention now",
    "activityLevel": "moderate",
    "reasons": ["SpO₂ 90% is in the ATTENTION range."]
  },
  "sessionContext": {
    "sessionId": "A02-LIVE",
    "baselineVerified": true,
    "wearerAssociationConfirmed": true,
    "signalQuality": "OK"
  },
  "readings": {
    "respiratoryRate": {
      "value": 16,
      "unit": "breaths/min",
      "baseline": 16,
      "deviationPct": null,
      "status": "NORMAL"
    },
    "oxygenSaturation": {
      "value": 90,
      "unit": "%",
      "baseline": 97.7,
      "deviationPct": null,
      "status": "ATTENTION"
    },
    "bloodPressure": {
      "systolic": 108,
      "diastolic": 68,
      "unit": "mmHg",
      "baseline": { "systolic": 113, "diastolic": 71.9 },
      "status": "NORMAL"
    },
    "bloodGlucose": {
      "value": 92,
      "unit": "mg/dL",
      "fasting": null,
      "baseline": null,
      "status": "NORMAL"
    },
    "heartRate": { "status": "unavailable" },
    "skinTemperature": { "status": "unavailable" }
  }
}
```

The historical NORMAL case is in `examples/overview-A01-historical.json`: `bioMonitorConnected: false`, `status.level: "NORMAL"`, and `reasons: ["Measurements remain close to your baseline."]`.

### 4.2 Field → element mapping

The Overview HTML has no ids. Add the suggested `id`s (or use the existing classes shown):

| Element (existing class → suggested id)                                | Field                         | Rendering rule                                                                                                  |
| ---------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `.health-summary h2` → `#status-headline`                              | `status.headline`             | As is                                                                                                           |
| `.health-summary .pill` → `#status-pill`                               | `status.level`                | Text = level; `data-tone` from §3.4                                                                             |
| `.health-summary-description` → `#status-description`                  | `status.reasons`              | `reasons.join(" ")`                                                                                             |
| Context "Mission Day" `.context-value` → `#ctx-mission-day`            | `missionDay`                  | `padStart(3, "0")`; `—` if null                                                                                 |
| Context "Current Activity" → `#ctx-activity`                           | `status.activityLevel`        | `low` → "Resting / low", `moderate` → "Moderate", `high` → "High (exercise)"                                    |
| Context "Monitoring" → `#ctx-monitoring`                               | `bioMonitorConnected`         | `true` → "Continuous"; `false` → "Bio-Monitor not connected"                                                    |
| `.section-status` ("Live readings") → `#live-indicator`                | `bioMonitorConnected`, `asOf` | Connected → "Live readings"; otherwise "Last reading {asOf, local time}"                                        |
| Metric card per key (add `data-metric="<key>"` to each `.metric-card`) | `readings.<key>`              | See 4.3                                                                                                         |
| "Why this status?" `.interpretation-content h3`                        | `status.level`                | NORMAL → "Physiological parameters are stable"; WATCH → "Monitoring a deviation"; ATTENTION → "Needs attention" |
| "Why this status?" `.interpretation-content p`                         | `status.reasons`              | One `<p>` per reason                                                                                            |

### 4.3 Metric cards

For `respiratoryRate` and `oxygenSaturation` (`SingleReading`):

| Card element                             | Field                         | Rule                                                                                                                                                                                        |
| ---------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.metric-value`                          | `value`                       | As is (`16`, `90`)                                                                                                                                                                          |
| `.metric-unit`                           | `unit`                        | As is                                                                                                                                                                                       |
| `.comparison-value`                      | `baseline` + `unit`           | `"16 breaths/min"`, or `"97.7%"` for `%` (no space). `—` if `baseline` is null                                                                                                              |
| `.comparison-change`                     | `deviationPct`, else computed | If `deviationPct` is non-null, show it. Otherwise, when `baseline` is non-null, show `((value - baseline) / baseline * 100)` to 1 decimal with a sign (`+2.9%`). Hide when baseline is null |
| card status (add a small pill or border) | `status`                      | Tone from §3.4                                                                                                                                                                              |

For `bloodPressure`:

- `.metric-value` = `` `${systolic}/${diastolic}` ``.
- `.comparison-value` = `` `${baseline.systolic}/${baseline.diastolic} mmHg` `` (round to integers for display), or `—` if `baseline` is null.

For `bloodGlucose`, **add a new card** (the design has none):

- value + "mg/dL"
- a "Fasting" tag when `fasting === true`
- no baseline row (`baseline` is always null for glucose)

For `heartRate` and `skinTemperature` (always unavailable): either remove these cards, or keep them greyed out with `.metric-value` = "—", `.metric-unit` = "", and `.comparison-value` = "Not measured by this system".

### 4.4 States

| Condition                                         | Show                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| Loading                                           | Skeleton or "Loading…" on every card                                 |
| `readings === null` and `status === null`         | "No readings yet for this astronaut". Hide the metric grid           |
| `readings.<key>` is `{ "status": "unavailable" }` | That card in the "Not measured" style                                |
| `bioMonitorConnected === false`                   | Neutral pill "Bio-Monitor not connected", plus "Last reading {asOf}" |
| 404 `astronaut_not_found`                         | Full-page message plus a link to `?astronautId=A01`                  |
| Network error                                     | Keep the last good data, show a "Connection lost, retrying" banner   |

### 4.5 Good to know

- `readings` may combine values from more than one recent record. If a sensor sends only some fields, the others keep their last measured value (e.g. glucose comes from the glucose sensor's last record). `asOf` is the latest record overall.
- `baseline` is the astronaut's own reference for the **current** context. In flight it is the head-down-tilt (microgravity-analog) baseline when one exists, so it can differ from the normal-Earth number on the Profile page. That is intended.
- `deviationPct` is only computed for resting (low-activity) readings, which is why it is often `null`.

---

## 5. Health Trends screen (`health-trends.html`)

`GET /api/trends/:astronautId?period=7` on load; call again with `period=30` when the 30-day toggle is pressed. Only `7` and `30` are accepted; anything else returns 400.

### 5.1 Response (excerpt from `examples/trends-A01-7-days.json`)

```json
{
  "period": 7,
  "asOf": "2026-11-06",
  "metrics": {
    "heartRate": { "status": "unavailable" },
    "skinTemperature": { "status": "unavailable" },
    "respiratoryRate": {
      "status": "available",
      "unit": "breaths/min",
      "min": 8,
      "max": 22,
      "days": [
        {
          "date": "2026-10-31",
          "missionDay": 24,
          "value": 15.4,
          "samples": 288
        },
        {
          "date": "2026-11-01",
          "missionDay": 25,
          "value": 15.4,
          "samples": 287
        }
      ]
    },
    "oxygenSaturation": {
      "status": "available",
      "unit": "%",
      "min": 90,
      "max": 100,
      "days": [
        {
          "date": "2026-10-31",
          "missionDay": 24,
          "value": 97.8,
          "samples": 288
        }
      ]
    },
    "bloodGlucose": {
      "status": "available",
      "unit": "mg/dL",
      "min": 60,
      "max": 160,
      "days": [
        {
          "date": "2026-10-31",
          "missionDay": 24,
          "value": 96.1,
          "samples": 288
        }
      ]
    },
    "bloodPressure": {
      "status": "available",
      "unit": "mmHg",
      "min": 80,
      "max": 150,
      "days": [
        {
          "date": "2026-10-31",
          "missionDay": 24,
          "systolic": 106.2,
          "diastolic": 66.8,
          "status": "NORMAL"
        }
      ]
    }
  },
  "ultrasound": [
    {
      "timestampUtc": "2026-09-06T14:00:00.000Z",
      "missionDay": null,
      "inFlight": false,
      "status": "NORMAL",
      "ijvAreaMm2": 9.2,
      "ijvFlowGrade": 1,
      "onsdMm": 5.2,
      "onsdBaselineMm": 5.2,
      "cimtMm": 0.54,
      "lvefPct": 61,
      "muscleThicknessMm": 21.8,
      "muscleLossPct": 0
    },
    {
      "timestampUtc": "2026-11-06T14:00:00.000Z",
      "missionDay": 30,
      "inFlight": true,
      "status": "WATCH",
      "ijvAreaMm2": 80,
      "ijvFlowGrade": 3,
      "onsdMm": 6.95,
      "onsdBaselineMm": 5.2,
      "cimtMm": 0.58,
      "lvefPct": 60,
      "muscleThicknessMm": 21.32,
      "muscleLossPct": 2.94
    }
  ]
}
```

### 5.2 Replacing the hardcoded `HEALTH_DATA`

`health-trends.js` currently renders from a constant shaped `{ <key>: { min, max, values: { 7: [...], 30: [...] } } }`. Keep the chart code and swap the data source with this adapter:

```js
// In health-trends.js: replaces the HEALTH_DATA constant.
const HEALTH_DATA = {};

function toMetric(trend, period, pick = (d) => d.value) {
  if (trend.status !== "available") return null;
  return {
    min: trend.min,
    max: trend.max,
    values: { [period]: trend.days.map(pick) },
    labels: trend.days.map((d) =>
      d.missionDay ? `D${d.missionDay}` : d.date.slice(5),
    ),
  };
}

async function loadTrends(period) {
  const id = encodeURIComponent(getAstronautId());
  const data = await apiGet(`/api/trends/${id}?period=${period}`);
  const m = data.metrics;
  HEALTH_DATA.respiratoryRate = toMetric(m.respiratoryRate, period);
  HEALTH_DATA.oxygenSaturation = toMetric(m.oxygenSaturation, period);
  HEALTH_DATA.bloodGlucose = toMetric(m.bloodGlucose, period);
  HEALTH_DATA.bloodPressure = toMetric(
    m.bloodPressure,
    period,
    (d) => d.systolic,
  );
  HEALTH_DATA.heartRate = null; // unavailable
  HEALTH_DATA.skinTemperature = null; // unavailable
  return data;
}
```

Required HTML/JS changes:

| Change                                                                                                           | Why                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `data-metric="temperature"` → `data-metric="skinTemperature"`                                                    | One key everywhere (§3.1)                            |
| `data-metric="oxygen"` → `data-metric="oxygenSaturation"`                                                        | Same                                                 |
| Add a `<article class="card metric-card" data-metric="bloodGlucose">` card ("METABOLIC / Blood glucose / mg/dL") | Glucose is measured; the design has no card for it   |
| `renderMetric`: if `HEALTH_DATA[key]` is `null`, show "Not measured by this system" instead of a chart           | Heart rate and skin temperature                      |
| `updateDashboard(period)`: `await loadTrends(period)` before rendering; show loading and error states            | Data is now remote                                   |
| Bar labels: use `labels[index]` (mission day) instead of `D${index + 1}`                                         | Days can be missing; the index isn't the mission day |
| Change "Illustrative data" in `.chart-caption` to "Daily averages · last reading {asOf}"                         | Data is real (synthetic mock) now                    |

### 5.3 Rules

- `days` is oldest-first and **only contains days with data**. A 30-day request can return fewer than 30 entries, and an astronaut with no data returns `days: []` with `asOf: null`. Show "No data for this period".
- The window ends on `asOf` (the latest day that has data), **not today**. With the seeded data that is 2026-11-06.
- `min` and `max` are the chart axis range. Clamp bars to it, as `barHeightPercent` already does.
- Blood pressure: chart `systolic`, and show `diastolic` in the bar tooltip (`title`). Each day also has a `status` (resting-BP judgement of that daily average); colour the bar with §3.4 if you like.
- `ultrasound` lists every scan (pre-flight scans have `missionDay: null`), not just those in the window. Optional section: ONSD line vs `onsdBaselineMm`, muscle loss %, and IJV flow grade, with `status` per scan.

---

## 6. Astronaut Profile screen (`profile.html`)

**Already integrated.** `profile.js` calls `GET /api/profile/:id` and `GET /api/baseline/:id` and reads exactly the fields below. The only change needed: open the page with `?astronautId=A01` (or A02); the old hint mentions `AST-001`.

### 6.1 `GET /api/profile/:astronautId` (`examples/profile-A02-connected.json`)

```json
{
  "astronautId": "A02",
  "displayName": "Crew Member 02",
  "crewNumber": "02",
  "sex": "F",
  "mission": { "name": "Artemis" },
  "identityStatus": {
    "state": "verified",
    "description": "Astronaut identity verified via onboard device"
  },
  "baselineStatus": { "state": "approved", "label": "Approved baseline" },
  "deviceStatus": { "state": "connected", "label": "Bio-Monitor linked" },
  "updatedAt": "2026-11-14T22:07:59.969Z"
}
```

| Element id                 | Field                                                    | Notes                                          |
| -------------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| `#astronaut-avatar`        | initials of `displayName`                                |                                                |
| `#crew-number`             | `crewNumber`                                             | rendered as "CREW MEMBER 02"                   |
| `#identity-heading`        | `displayName`                                            |                                                |
| `#identity-description`    | `identityStatus.description`                             |                                                |
| `#identity-mission`        | `mission.name`                                           | `mission` can be `null`: show "Not assigned"   |
| `#identity-id`             | `astronautId`                                            |                                                |
| `#mission-context`         | `mission.name` + crew                                    |                                                |
| `#baseline-approval-badge` | `baselineStatus.label`, tone from `baselineStatus.state` | `approved` → success, `pending` → neutral      |
| `#device-link-badge`       | `deviceStatus.label`, tone from `deviceStatus.state`     | `connected` → accent, `disconnected` → warning |
| `#profile-last-updated`    | `updatedAt`                                              |                                                |

### 6.2 `GET /api/baseline/:astronautId` (`examples/baseline-A01.json`, `examples/baseline-A02-with-provisional.json`)

```json
{
  "approvalStatus": { "label": "Approved pre-flight baseline" },
  "methodDescription": "Proposed 7–14 pre-flight days · repeated standardized resting sessions · mean and sample SD per test condition, never pooled · fewer than 6 valid sessions is provisional · separate from in-flight trends",
  "parameters": {
    "heartRate": { "status": "unavailable" },
    "skinTemperature": { "status": "unavailable" },
    "respiratoryRate": {
      "status": "approved",
      "mean": 16.04,
      "standardDeviation": 0.54,
      "n": 12,
      "referenceLabel": "Verified pre-flight reference"
    },
    "oxygenSaturation": {
      "status": "approved",
      "mean": 97.57,
      "standardDeviation": 0.43,
      "n": 12,
      "referenceLabel": "Verified pre-flight reference"
    },
    "bloodPressure": {
      "status": "approved",
      "mean": { "systolicMmHg": 116.36, "diastolicMmHg": 74.08 },
      "standardDeviation": { "systolicMmHg": 2.09, "diastolicMmHg": 1.2 },
      "n": 12,
      "referenceLabel": "Verified pre-flight reference"
    }
  },
  "byCondition": [
    {
      "condition": "normal_earth",
      "respiratoryRate": { "...": "same card shape" },
      "oxygenSaturation": {},
      "bloodPressure": {}
    },
    {
      "condition": "reduced_pressure",
      "oxygenSaturation": {
        "status": "provisional",
        "n": 5,
        "referenceLabel": "Provisional: only 5 valid sessions",
        "...": ""
      }
    }
  ]
}
```

- `parameters.<key>` drives the five `.baseline-card[data-metric]` cards. `profile.js` already handles `status: "unavailable"` → "Not available".
- `status` is `approved` or `provisional`. Provisional (fewer than 6 sessions) may be styled with `warning`.
- `standardDeviation` can be `null` (fewer than 2 sessions). `profile.js` already shows "not available".
- `byCondition` is **optional extra**: one entry per test condition (`normal_earth`, `head_down_tilt`, `dry_immersion`, `raised_co2`, `reduced_pressure`) with the same card shapes. Good for a "Baselines by test condition" table.
- An astronaut with no baseline data returns 200 with every card unavailable and `approvalStatus.label = "Awaiting baseline data"`. Only an unknown astronaut is a 404.

---

## 7. Connection screen (`connection.html`)

`GET /api/connection/:astronautId`, polled every 15 s. There are always exactly 4 steps, in order. Map `steps[i]` to the i-th `.step-card`.

### 7.1 Response (`examples/connection-A02-ready.json`)

```json
{
  "astronautId": "A02",
  "steps": [
    {
      "step": 1,
      "key": "verify_identity",
      "label": "Verify identity",
      "status": "verified",
      "note": "Prototype: the onboard device performs the biometric check; the backend has no authentication yet."
    },
    {
      "step": 2,
      "key": "retrieve_baseline",
      "label": "Retrieve approved baseline",
      "status": "verified"
    },
    {
      "step": 3,
      "key": "connect_bio_monitor",
      "label": "Connect Bio-Monitor",
      "status": "connected",
      "sessionId": "A02-LIVE",
      "lastReadingAt": "2026-11-14T22:10:00.000Z"
    },
    {
      "step": 4,
      "key": "start_monitoring",
      "label": "Start monitoring",
      "status": "ready"
    }
  ]
}
```

A01 (stale data) returns step 3 `"waiting"` and step 4 `"blocked"` (`examples/connection-A01-waiting.json`).

### 7.2 Mapping

| Element                             | Field                                         | Rule                                                                                                      |
| ----------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `.step-card__title`                 | `label`                                       |                                                                                                           |
| `.step-card .pill`                  | `status`                                      | Text and tone from the table below                                                                        |
| `.step-card__description`           | —                                             | Keep the existing copy. Step 3 can add "Session {sessionId} · last reading {lastReadingAt}"               |
| Top pill "Bio-Monitor connected"    | `steps[2].status`                             | `connected` → "Bio-Monitor connected" (default tone); `waiting` → "Bio-Monitor not connected" (`neutral`) |
| Eyebrow "MISSION DAY 042 / CREW 01" | overview `missionDay`, astronaut `crewNumber` | See §2 header row                                                                                         |

| `status`    | Pill text | `data-tone` |
| ----------- | --------- | ----------- |
| `verified`  | Verified  | _(default)_ |
| `connected` | Connected | _(default)_ |
| `ready`     | Ready     | _(default)_ |
| `pending`   | Pending   | `neutral`   |
| `waiting`   | Waiting   | `neutral`   |
| `blocked`   | Blocked   | `warning`   |

"Connected" means the latest reading is at most 15 minutes old by the server clock. The seeded historical data is older than that, so it shows `waiting` until a live replay runs (§9).

---

## 8. Operator flows (optional UI)

### 8.1 Ultrasound entry form: `POST /api/ultrasound` (JSON, snake_case)

| Field                 | Type            | Required | Allowed                                      | Form control                         |
| --------------------- | --------------- | -------- | -------------------------------------------- | ------------------------------------ |
| `timestamp_utc`       | ISO date-time   | yes      | —                                            | datetime-local, converted to UTC ISO |
| `astronaut_id`        | string          | yes      | existing id                                  | hidden / picker                      |
| `source`              | enum            | yes      | send `"manual_entry"`                        | hidden                               |
| `in_flight`           | boolean         | yes      | —                                            | checkbox                             |
| `condition`           | enum            | yes      | `normal_earth` (pre-flight) or `spaceflight` | select, tied to `in_flight`          |
| `mission_day`         | integer or null | no       | —                                            | number                               |
| `ijv_area_mm2`        | number          | no*      | 0–250                                        | number, step 0.1                     |
| `ijv_flow_grade`      | integer         | no*      | 1–4                                          | select 1/2/3/4                       |
| `onsd_mm`             | number          | no*      | 2–12                                         | number, step 0.01                    |
| `cimt_mm`             | number          | no*      | 0.1–3                                        | number, step 0.01                    |
| `lvef_pct`            | number          | no*      | 5–95                                         | number                               |
| `muscle_thickness_mm` | number          | no*      | 1–150                                        | number, step 0.01                    |

\* At least one measurement is required. Send `null` (or omit the field) for blanks.

Responses:

- `201` → `{ "stored": true, "status": "WATCH", "muscle_loss_pct": 3.49, "explanation": "IJV flow grade 3 (stasis). ONSD 6.4 mm exceeds your pre-flight baseline 5.20 + 0.91 mm." }` Show the status pill and the explanation.
- `400 validation_failed` → put each `details[i].message` under its field. `details[i].field` is the snake_case field name (`examples/ultrasound-post-validation-error.json`).
- `409 scan_already_exists` → "A scan already exists for this time".
- `404 astronaut_not_found`.

### 8.2 CSV upload: `POST /api/upload?type=profiles|baseline|ultrasound|stream`

The body is the **raw CSV text** with `Content-Type: text/csv`. It is **not** multipart/form-data:

```js
const file = input.files[0];
const { body } = await apiPost(
  `/api/upload?type=${type}`,
  await file.text(),
  "text/csv",
);
// body: { type, rows, stored, duplicates, artifacts, errors, error_rows: [{ line, message }] }
```

Real response with two bad rows (`examples/upload-stream-with-row-errors.json`):

```json
{
  "type": "stream",
  "rows": 4,
  "stored": 2,
  "duplicates": 0,
  "artifacts": 0,
  "errors": 2,
  "error_rows": [
    {
      "line": 3,
      "message": "activity_level: Invalid enum value. Expected 'low' | 'moderate' | 'high', received 'jogging'"
    },
    {
      "line": 4,
      "message": "astronaut_id: no astronaut with id A99 (upload profiles first)"
    }
  ]
}
```

- A 200 response can still contain row errors. Show "Stored X of Y rows" and list `error_rows` (line 1 is the header).
- Only the first 50 failed rows are listed; `errors` is the total.
- Upload order for a fresh database: `profiles` → `baseline` → `ultrasound` → `stream`.
- Size limit 30 MB. The full 17,218-row stream takes ~5 s.

### 8.3 `POST /api/readings`

This is for sensors and the replay script, not the browser UI. The body is the common record (see `openapi.yaml` → `ReadingRecord`). It returns `201` stored, or `200 { "stored": false, "duplicate": true }` for a repeat of the same timestamp + astronaut + source.

---

## 9. Testing against a local backend

```bash
# in hackbio-backend
cp .env.example .env && docker compose up -d && npm install && npx prisma generate
npm run db:migrate && npm run seed -- --reset && npm run dev   # http://localhost:3000
```

Serve the frontend from `http://localhost:5500` (VS Code Live Server) so CORS allows it.

Demo scenarios:

| To see                               | Do                                                                                     | Then check                                                                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Historical NORMAL, disconnected      | nothing                                                                                | Overview A01 NORMAL; Connection step 3 "waiting"                                                                                                                                 |
| A live session                       | `npm run replay -- --astronaut A02 --rate 5 --shift-to-now`                            | Connection A02 all four steps ready; Overview updates on each poll                                                                                                               |
| Immediate ATTENTION (SpO₂ 90–91)     | `npm run replay -- --astronaut A02 --from-day 20 --limit 129 --rate 50 --shift-to-now` | Overview A02 ATTENTION, reason "SpO₂ 91% is in the ATTENTION range." (the replay stops inside the event, so the status stays)                                                    |
| WATCH escalated to ATTENTION at rest | `npm run replay -- --astronaut A01 --from-day 14 --limit 150 --rate 50 --shift-to-now` | Overview A01 ATTENTION, reason "Respiratory rate 23.1 breaths/min has stayed in the WATCH range for 90 min at low activity; …" Use `--limit 137` to stop while it is still WATCH |
| Status history                       | open `GET /api/events/A01`                                                             | NORMAL → WATCH at 2026-11-01T16:00Z (in-flight low SBP)                                                                                                                          |
| Provisional baseline                 | `GET /api/baseline/A02` → `byCondition` `reduced_pressure`                             | `status: "provisional"`                                                                                                                                                          |

`npm run seed -- --reset` restores the clean seeded state at any time.

---

## 10. Agent task checklist

Do these in order; each item has an acceptance check.

1. **Config + helper.** Add `js/config.js` and `js/api.js` (§1.1, §1.3) and include them on all four pages before the page scripts.
   _Check:_ `apiGet("/health")` in the console resolves `{ ok: true }`.
2. **Status tone.** Add `.pill[data-tone="danger"]` to `css/components.css` (§3.4).
   _Check:_ a pill with `data-tone="danger"` renders red.
3. **Overview.** Add the ids from §4.2 and `data-metric` on the metric cards, and write `js/overview.js` that renders §4 and polls every 30 s.
   _Check:_ after `npm run seed -- --reset`, `index.html?astronautId=A01` shows NORMAL, mission day 030, "Bio-Monitor not connected", and the heart-rate card as not measured. After the SpO₂ replay in §9, `?astronautId=A02` shows ATTENTION with the red pill.
4. **Health Trends.** Rename the two `data-metric` keys, add the glucose card, and replace `HEALTH_DATA` with the adapter in §5.2.
   _Check:_ 7 bars for A01 in the 7-day view; the 30-day view has 30 bars; heart rate and skin temperature show "Not measured".
5. **Profile.** Change only the `AST-001` hint text to `A01`.
   _Check:_ `profile.html?astronautId=A01` shows "Mariam", "Approved baseline", and respiratory rate "15.1 breaths/min" with "Standard deviation: 0.38 breaths/min".
6. **Connection.** Write `js/connection.js` per §7 and poll every 15 s.
   _Check:_ A01 shows step 3 "Waiting" and step 4 "Blocked". During a replay, A02 shows all four steps green.
7. **Header context.** Fill "MISSION DAY / CREW" from overview and astronauts on each page.
   _Check:_ A01 shows `MISSION DAY 030 / CREW 01`.
8. **Errors.** `?astronautId=A99` on each page shows the not-found state; stopping the backend shows the offline state, and pages recover when it is back.

---

## 11. Enumerations reference

| Name                   | Values                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| HealthStatus           | `NORMAL`, `WATCH`, `ATTENTION`                                                             |
| ActivityLevel          | `low`, `moderate`, `high`                                                                  |
| SignalQuality          | `OK`, `LOW`, `ARTIFACT`                                                                    |
| Source (ingest)        | `bio_monitor`, `glucose_sensor`, `manual_entry`, `mock`                                    |
| TestCondition          | `normal_earth`, `head_down_tilt`, `dry_immersion`, `raised_co2`, `reduced_pressure`        |
| Ultrasound condition   | `normal_earth`, `spaceflight`                                                              |
| Baseline card status   | `approved`, `provisional`, `unavailable`                                                   |
| Profile badge states   | baseline: `approved`, `pending`; device: `connected`, `disconnected`; identity: `verified` |
| Connection step status | `verified`, `pending`, `connected`, `waiting`, `ready`, `blocked`                          |
| Trends period          | `7`, `30`                                                                                  |

## 12. Limitations the UI should not hide

- **No authentication.** Anyone with the URL can read and write. Don't put real personal data in it.
- **All data is synthetic**, and the thresholds are prototype rules, not medical limits. Keep a small "Prototype · synthetic data" note on the dashboard.
- **Heart rate and skin temperature are not measured.** Don't fabricate values for them.
- **The personal-baseline comparison does not change the status in this version.** It is shown as baseline and deviation only. The status comes from the threshold table, activity context and persistence.
