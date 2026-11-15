# Astronaut health-monitoring prototype: mock data pack

**Everything in `data/` is synthetic.** No value is a real astronaut measurement. Use it to test the
software, never to set baselines or thresholds. Every stream/ultrasound row carries `source = mock`.

Built to match the proposal's "Mock Data for Development and Testing" section exactly:
17,218 stream rows, 120 baseline sessions, 18 ultrasound scans, 2 profiles.

## Quick start

```bash
npm install                 # only needed for the Express example
npm run generate            # rewrites ./data (deterministic, seed 20261114)
npm run validate            # 49 checks against the proposal's rules
npm run serve               # example Express app on :3000
node generate_mock_data.js replay --dry-run --limit 3
node generate_mock_data.js replay --astronaut A01 --rate 1 --shift-to-now   # live-feed replay
```

## Files

| File | Rows | Use |
|---|---|---|
| `data/mock_realtime_stream.csv` | 17,218 | Live feed (`POST /api/v1/readings`) or bulk (`POST /api/v1/upload?type=stream`). 2 astronauts x 30 days x 5 min |
| `data/mock_baseline_sessions.csv` | 120 | Baseline mean/SD per astronaut and test condition (5 conditions x 12 sessions x 2 astronauts) |
| `data/mock_ultrasound_measurements.csv` | 18 | Manual form / CSV upload. 3 pre-mission + 6 in-mission scans per astronaut |
| `data/mock_astronaut_profiles.csv` | 2 | A01 male, A02 female (LVEF limits), launch day 8 |
| `data/thresholds_transcribed_from_proposal.csv` | 47 | The NORMAL/WATCH/ATTENTION table as interval rows |
| `data/json/*.json` | | Same tables as JSON, plus the answer keys below |
| `data/json/thresholds.json` | | Thresholds + in-flight adjustments + persistence placeholders (all `null`) |
| `data/json/expected_events.json` | | **Answer key**: each labelled event, window, expected status |
| `data/json/expected_baseline_stats.json` | | **Answer key**: mean, sample SD, n for each baseline group |
| `lib/csv.js` | | Dependency-free CSV parse/write + typed loading (`TYPES`) |
| `examples/server.js` | | Express reference: common record, ARTIFACT marking, duplicate ignoring, CSV upload |
| `generate_mock_data.js`, `validate.js` | | Generator (with `replay`) and checker |

Timeline: mission day 1 = 2026-10-08 (UTC). Days 1-7 ground, 8-30 in flight. `session_id` = `A01-D08`
is 2026-10-15, matching the proposal's example row. Event times are UTC, windows are inclusive.

### Common record (stream CSV columns)
`timestamp_utc, astronaut_id, session_id, source, in_flight, activity_level, resp_rate_bpm, spo2_pct, sbp_mmhg, dbp_mmhg, glucose_mgdl, fasting, signal_quality, mission_day, scenario_tag`

Ultrasound CSV: `timestamp_utc, astronaut_id, source, in_flight, condition, mission_day, ijv_area_mm2, ijv_flow_grade, onsd_mm, cimt_mm, lvef_pct, muscle_thickness_mm, scenario_tag`
(`condition` = `normal_earth` pre-mission, `spaceflight` in flight; muscle thickness is in mm, the system derives % change.)

### Labelled test events (all pass `npm run validate`)
| scenario_tag | Who / when (UTC) | Expected instant status |
|---|---|---|
| *(none)* exercise 09:00-10:00 daily | both, every day | RR reaches 21-24, **NORMAL** (activity explains it) |
| `rr_high_at_rest_sustained` | A01 day 14 11:00-12:30 | WATCH, then ATTENTION once your persistence limit passes |
| `spo2_dip_watch` | A01 day 19 03:00-03:25 | WATCH |
| `hypoglycemia_event` | A01 day 22 15:00-15:55 | WATCH, ATTENTION (<54), back to NORMAL |
| `sbp_low_inflight_watch` | A01 day 25 16:00-16:40 | WATCH (SBP 95-99) |
| `sbp_low_ground_watch` | A02 day 5 10:30-11:00 | WATCH (106-109); would be NORMAL in flight |
| `fasting_glucose_elevated` | A02 days 16-18 04:00-07:30 | WATCH, persistent 3 mornings |
| `spo2_low_attention` | A02 day 20 10:30-10:40 | ATTENTION immediately (moderate activity does not explain SpO2) |
| `sensor_artifact` | A02 day 24 13:20-13:45 | ARTIFACT: stored, ignored |
| ultrasound `ijv_grade3_watch` / `ijv_grade3_onsd_rise_watch` | A01 days 24 and 30 | WATCH (grade 3; day 30 also ONSD 6.95 > baseline 5.20 + 0.91) |

Outside these windows every record is NORMAL: a wrong status points straight at the rule to fix.
Also built in: ~1% `LOW` quality records (noisy but kept inside NORMAL), one 40-minute dropout
(A01 day 11 03:10-03:45), 54 isolated missing records, and one baseline condition
(A02 `reduced_pressure`, only 5 valid sessions) that must be treated as **provisional** (<6 sessions).

## What I found in the NASA sources

| Source | What it offers for this project | Limit |
|---|---|---|
| OSDR (osdr.nasa.gov) | Open access to space biology data. Inspiration4 (I4) processed commercial-astronaut data is hosted. Public Biological Data API and public AWS S3 bucket exist | I4 in OSDR is omics + clinical assays. I could not confirm continuous heart-rate, BP, SpO2 or glucose series are public. Astronaut sequence data is controlled access |
| NLSP / LSDA (nlsp.nasa.gov) | Archive of human spaceflight and bed-rest research data (1961 to present) | Needs a formal data request; astronaut data falls under the Privacy Act. Nothing downloadable on the spot |
| HRP (nasa.gov/hrp) | Programme overview: countermeasures, radiation, behavioural health | The page itself lists no physiological findings; the risk pages it links to were not in what I could read |
| OSDR FAQ | Search filters, file download, API/S3 access | Confirms astronaut-derived processed data is public, sequence data controlled |

My sandbox's network blocked the OSDR API (HTTP 403 from the proxy), so I did **not** pull raw OSDR
datasets. Magnitudes below come from published spaceflight papers (some of which use data held by NASA archives).

## Real anchor vs simulation, per parameter

| Parameter | Published anchor | What the mock does |
|---|---|---|
| Resp. rate | NEWS2 bands from the proposal; no spaceflight shift claimed | Resting 15 / 16 bpm, sleep -1, moderate +2.5, exercise peak 21.6-23.0 |
| SpO2 | I4 wearables recorded SpO2 (Penn Medicine release); no public series found | Resting 98.0 / 97.6, sleep -0.4, always 96-99 outside events |
| Blood pressure | Norsk 2015: 24-h ambulatory SBP -8, DBP -9 mmHg over 85-192 days (8 men). Fu 2019: SBP 120 to 106, DBP unchanged (12 astronauts) | SBP baseline 116/117 falls 11/10 over the first two flight days (daily mean 117.3 to ~106.3); DBP falls 5 |
| Glucose | Insulin-resistance changes reported in spaceflight; no continuous astronaut glucose data found | Fasting 76-97, meals at 07:30/12:30/18:30 peak ~+38-42, excursions +8% in flight (my assumption) |
| IJV area / flow | Marshall-Goebel 2019: mean area 9.8 to 70.3 mm2; stagnant or reverse flow in 6 of 11 (55%) | Pre 8-10 mm2; in flight 52-80 mm2; A01 grade 3 on days 24 and 30 |
| ONSD | Increase in flight reported across studies; Fall 2022 review stresses poor standardisation of methods | A01 5.20 to 6.05 to 6.95 mm; A02 5.10 to 5.80 (stays under baseline + 0.91) |
| cIMT | Arbeille 2025: 0.56 to 0.65 mm at ~day 150 (10 astronauts); 2016 study: +12% | Pre 0.50-0.55; +0.03 to +0.04 mm over 30 days (conservative for a short mission) |
| LVEF | Proposal says preserved over 6-month missions; I could not confirm independently | Stable 60-62 (A01) and 62-64 (A02) |
| Muscle thickness | ~13% calf **volume** loss over 6 months by MRI (Trappe 2009, as summarised by Scientific American) | Loss 0.4% to 3.6% over 23 flight days. Faster than the 6-month average so the trend is visible, and kept under the 4% WATCH line |
| Baseline conditions | Direction only (HDT/dry immersion lower BP; low pressure lowers SpO2; raised CO2 raises RR) | **Placeholder** effect sizes, as the proposal says |

Not generated, on purpose: heart rate, body temperature, sleep, mood and radiation. The proposal's
parameter list does not include them (it treats radiation as context only, if a feed ever exists).
Say if you want them added.

## Cross-check: things in the proposal worth fixing or confirming

1. **`astronaut_health_thresholds.csv` was not attached.** I transcribed the table into `thresholds_transcribed_from_proposal.csv`. Prefer your original file if you have it.
2. **IJV statistic.** The proposal says Grade 3 in 55% and Grade 4 in 18%. The cited JAMA Netw Open paper reports 55% (6 of 11) as stagnant **or** retrograde combined. Check the split against the paper.
3. **Muscle thickness may not be a valid in-flight signal.** Scott et al. 2021 (iScience) found teleguided ultrasound muscle *thickness* did not detect size change in flight (high variability, rises and falls); panoramic ultrasound (cross-sectional area) tracked MRI. The 4-13% bands also look like volume/CSA losses, not thickness losses.
4. **ONSD gap and method.** NORMAL ends at 5.7 but WATCH starts at >5.8, so 5.7-5.8 has no status. The 5.8 and 7.2 mm limits match group means from an MRI study summarised in Fall 2022 (without vs with globe flattening). If that is the source they are group averages, not diagnostic cut-offs, and ultrasound ONSD is measured differently.
5. **Glucose gap.** No NORMAL band exists for non-fasted readings; fasting WATCH is 100-199. I added a labelled assumption (non-fasted 70-199 is NORMAL), otherwise every meal would alert.
6. **Activity can only explain RR and chronic BP.** The acute SBP WATCH range (91-110) is the low side, which exercise raises, so "activity explains WATCH" has nothing to act on there.
7. **Baseline protocol vs mock size.** The proposal asks for 14-28 session summaries, yet 120 rows give 12 per condition (and conditions are spread over 30 days, not 7-14). Fine for testing; note it if judges compare.
8. **Persistence limits** are not defined anywhere, so `thresholds.json` leaves them `null`. Pick them as config; do not hard-code.
9. **Could not verify:** the +0.91 mm ONSD rise, HOMA-IR +37-45%, LVEF thresholds, and the "8-14 mmHg" SBP band. The BP papers I found support a fall of about 8-14 mmHg (24-h SBP -8 and -14, i.e. 120 to 106).

## Assumptions I made (all labelled synthetic)

- Sex: A01 male, A02 female. Exercise peak RR varies per day. Plausible-limit values in `examples/server.js` (SpO2 above 100, SBP above 260, etc.) are my suggestions.
- Acute SBP is kept at or above 111 on the ground and 101 in flight (outside events) by design, so the only alerts are the labelled ones.
- Baseline sessions are `context = rest_seated`, 5-10 minutes, mean of 2-3 BP readings.

## Sources

- NASA, OSDR FAQ: https://science.nasa.gov/reference/osdr-faq/
- NASA, "NASA's Repository Supports Research of Commercial Astronaut Health": https://science.nasa.gov/humans-in-space/nasas-repository-supports-research-of-commercial-astronaut-health/
- NASA, OSDR Biological Data API tutorial: https://osdr-tutorials.readthedocs.io/en/latest/pages/guides/biological_data_api.html
- NASA NLSP, LSDA home: https://nlsp.nasa.gov/explore/lsdahome
- NASA HRP: https://www.nasa.gov/hrp/
- Jones et al. 2024, Inspiration4 physiology (Nature): https://pmc.ncbi.nlm.nih.gov/articles/PMC11357997 and Penn Medicine release: https://www.pennmedicine.org/news/first-study-of-civilian-space-crew-charts-course-for-research-as-commercial-flight-heats-up
- Marshall-Goebel et al. 2019, JAMA Netw Open: https://pmc.ncbi.nlm.nih.gov/articles/PMC6902784
- Norsk et al. 2015, J Physiol: https://pmc.ncbi.nlm.nih.gov/articles/4324706/
- Fu et al. 2019, Circulation: https://pubmed.ncbi.nlm.nih.gov/31319685/
- Fall et al. 2022, ONSD and spaceflight, npj Microgravity: https://pmc.ncbi.nlm.nih.gov/articles/PMC9537149
- Arbeille et al. 2025, carotid wall during 6-month spaceflight: https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2025.1638531/full
- Scott et al. 2021, teleguided self-ultrasound of muscle: https://pmc.ncbi.nlm.nih.gov/articles/PMC8047175
- Scientific American summary of Trappe et al. calf muscle loss: https://www.scientificamerican.com/blog/news-blog/spaceflight-wreaks-havoc-on-astrona-2009-04-08/
