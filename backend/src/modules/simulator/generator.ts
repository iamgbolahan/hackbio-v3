// A simulated Bio-Monitor. The value at any moment is a pure function of (astronaut, time), so a gap in the
// stream can be filled in afterwards and the same moment always gives the same reading.
// Routine follows the proposal's mock-data description: sleep 23:00-07:00, one hour of exercise at 09:00,
// meals at 07:30, 12:30 and 18:30, fasting flag 02:30-07:30, about 1% low-quality readings and the odd sensor dropout.

export interface SimBaseline {
  rr: number;
  spo2: number;
  sbp: number;
  dbp: number;
}

export interface SimSample {
  respRateBpm: number;
  spo2Pct: number;
  sbpMmhg: number;
  dbpMmhg: number;
  glucoseMgdl: number;
  fasting: boolean;
  activityLevel: "low" | "moderate" | "high";
  signalQuality: "OK" | "LOW";
  scenarioTag: string | null;
}

const DAY_MS = 86_400_000;
const BLOCK_MS = 3 * 3_600_000;

function hash(seed: number, a: number, b: number): number {
  let h = (seed + Math.imul(a | 0, 2654435761) + Math.imul(b | 0, 2246822507)) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 2146121005);
  h ^= h >>> 15;
  h = Math.imul(h, 2221713035);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function gauss(seed: number, a: number, b: number): number {
  const u = Math.max(hash(seed, a, b), 1e-9);
  const v = hash(seed, a + 1, b);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Slowly varying noise (changes over about a minute) plus fast beat-to-beat jitter.
function noise(seed: number, channel: number, t: number, scale: number): number {
  const slowIndex = Math.floor(t / 60_000);
  const fraction = t / 60_000 - slowIndex;
  const smooth = fraction * fraction * (3 - 2 * fraction);
  const slow =
    gauss(seed, channel, slowIndex) * (1 - smooth) +
    gauss(seed, channel, slowIndex + 1) * smooth;
  return slow * scale * 0.6 + gauss(seed, channel + 50, Math.floor(t / 5000)) * scale * 0.8;
}

// How far a reading strays from its baseline. The distance is re-drawn every 90 seconds: usually small, sometimes
// large, either side of the baseline, and eased from one draw to the next so the line moves instead of flipping
// between two numbers. Amplitude is the largest stray for that parameter.
function disparity(seed: number, channel: number, t: number, amplitude: number): number {
  const window = 90_000;
  const index = Math.floor(t / window);
  const fraction = (t - index * window) / window;
  const eased = fraction * fraction * (3 - 2 * fraction);
  const draw = (i: number) => {
    const size = Math.pow(hash(seed, channel + 100, i), 1.7); // most draws small, a few near the maximum
    const side = hash(seed, channel + 200, i) < 0.5 ? -1 : 1;
    return side * size * amplitude;
  };
  return draw(index) * (1 - eased) + draw(index + 1) * eased;
}

export function seedFor(astronautId: string): number {
  let h = 2166136261;
  for (let i = 0; i < astronautId.length; i++) {
    h ^= astronautId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface Episode {
  kind: "spo2_dip" | "spo2_drop" | "rr_high" | "bp_low";
  strength: number;
}

// One possible episode per three-hour block, so the abnormal states in the proposal's test events can occur.
function episodeAt(seed: number, t: number, frequent: boolean): Episode | null {
  const block = Math.floor(t / BLOCK_MS);
  const roll = hash(seed, 21, block) / (frequent ? 5 : 1);
  const jitter = hash(seed, 23, block);
  let kind: Episode["kind"] | null = null;
  let length = 0;
  if (roll < 0.06) {
    kind = "spo2_dip";
    length = 60_000 * (20 + 30 * jitter);
  } else if (roll < 0.075) {
    kind = "spo2_drop";
    length = 60_000 * (8 + 7 * jitter);
  } else if (roll < 0.12) {
    kind = "rr_high";
    length = 60_000 * (40 + 15 * jitter);
  } else if (roll < 0.16) {
    kind = "bp_low";
    length = 60_000 * (70 + 30 * jitter);
  }
  if (!kind) return null;
  const start = block * BLOCK_MS + hash(seed, 22, block) * (BLOCK_MS - length - 60_000);
  if (t < start || t > start + length) return null;
  const strength = Math.max(0, Math.min(1, (t - start) / 120_000, (start + length - t) / 120_000));
  return { kind, strength };
}

function activityAt(seed: number, t: number, episode: Episode | null): 0 | 1 | 2 {
  if (episode && (episode.kind === "rr_high" || episode.kind === "bp_low")) return 0;
  const hour = (t % DAY_MS) / 3_600_000;
  if (hour >= 23 || hour < 7) return 0;
  if (hour >= 9 && hour < 10) return 2;
  const bucket = hash(seed, 11, Math.floor(t / 600_000));
  return bucket < 0.6 ? 0 : bucket < 0.92 ? 1 : 2;
}

// A deterministic ~40 minute sensor dropout, roughly once every two days.
export function inDropout(seed: number, t: number): boolean {
  const day = Math.floor(t / DAY_MS);
  if (hash(seed, 31, day) > 0.5) return false;
  const start = day * DAY_MS + hash(seed, 32, day) * (DAY_MS - 2_400_000);
  return t >= start && t < start + 2_400_000;
}

export function sample(
  seed: number,
  base: SimBaseline,
  t: number,
  options: {
    inFlight: boolean;
    frequentEpisodes: boolean;
    // Minutes since the monitoring session began, when it is recent: one parameter opens in the WATCH range.
    minutesIntoSession?: number;
  },
): SimSample {
  const episode = episodeAt(seed, t, options.frequentEpisodes);
  const activity = activityAt(seed, t, episode);
  const hour = (t % DAY_MS) / 3_600_000;
  const asleep = hour >= 23 || hour < 7 ? 1 : 0;
  const flight = options.inFlight ? 1 : 0;

  let rr = base.rr - 0.3 * flight + [0, 2.2, 6][activity]! - 0.6 * asleep + noise(seed, 1, t, 0.4) + disparity(seed, 1, t, 5);
  let spo2 = base.spo2 - [0, 0.2, 0.5][activity]! + noise(seed, 2, t, 0.3) + disparity(seed, 2, t, 2.6);
  let sbp = base.sbp - 10 * flight + [0, 7, 24][activity]! - 5 * asleep + noise(seed, 3, t, 1.2) + disparity(seed, 3, t, 14);
  const dbp = base.dbp - 5.5 * flight + [0, 4, 9][activity]! - 3 * asleep + noise(seed, 4, t, 0.8) + disparity(seed, 4, t, 11);
  let glucose = 86 + noise(seed, 5, t, 1.8) + disparity(seed, 5, t, 15);
  for (const meal of [7.5, 12.5, 18.5]) {
    const since = hour - meal;
    if (since > 0) glucose += (since / 0.75) * 38 * Math.exp(1 - since / 0.75);
  }

  let tag: string | null = null;
  if (episode) {
    const w = episode.strength;
    if (episode.kind === "spo2_dip") spo2 += (93.6 - spo2) * w;
    if (episode.kind === "spo2_drop") spo2 += (90.2 - spo2) * w;
    if (episode.kind === "rr_high") rr += (22.3 - rr) * w;
    if (episode.kind === "bp_low") sbp += (97 - sbp) * w;
    tag = `sim_${episode.kind}`;
  }

  // First 25 minutes of a session: one parameter (SpO2 or respiratory rate, by astronaut) starts in WATCH and settles.
  const m = options.minutesIntoSession;
  if (m !== undefined && m >= 0 && m < 25) {
    const w = m < 15 ? 1 : (25 - m) / 10;
    if (seed % 2 === 1) spo2 += (94 - spo2) * w;
    else rr += (22.4 - rr) * w;
    tag ??= "sim_session_start_watch";
  }

  const lowQuality = hash(seed, 41, Math.floor(t / 5000)) < 0.01;
  return {
    respRateBpm: Math.round(rr),
    spo2Pct: Math.min(100, Math.round(spo2)),
    sbpMmhg: Math.round(sbp),
    dbpMmhg: Math.round(dbp),
    glucoseMgdl: Math.round(glucose),
    fasting: hour >= 2.5 && hour < 7.5,
    activityLevel: (["low", "moderate", "high"] as const)[activity],
    signalQuality: lowQuality ? "LOW" : "OK",
    scenarioTag: tag,
  };
}
