// Pure signal logic. Everything visual is derived from these values and nothing else.

const BASS = [30, 180];
const MID = [180, 2200];
const HIGH = [2200, 12000];
const PROFILE_BANDS = 8;
const WAVE_POINTS = 128;
const FLOOR = 0.12; // analyser noise floor, roughly -82 dB on a -90..-20 dB byte scale
const REST = 0.0015;

const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0); // NaN falls through to 0
const settle = (v) => (v < REST ? 0 : v);

const PROFILE_EDGES = Array.from(
  { length: PROFILE_BANDS + 1 },
  (_, i) => MID[0] * (MID[1] / MID[0]) ** (i / PROFILE_BANDS),
);

// Mean alone hides one strong partial in a wide band, and a guitar note is mostly partials.
export function bandEnergy(data, sampleRate, fftSize, lo, hi) {
  if (!(sampleRate > 0 && fftSize > 0)) return 0;
  const first = Math.ceil((lo * fftSize) / sampleRate);
  const last = Math.min(data.length - 1, Math.ceil((hi * fftSize) / sampleRate) - 1);
  if (last < first) return 0;
  let sum = 0;
  let peak = 0;
  for (let i = first; i <= last; i++) {
    sum += data[i];
    if (data[i] > peak) peak = data[i];
  }
  const level = (0.5 * sum) / (last - first + 1) / 255 + (0.5 * peak) / 255;
  return clamp01((level - FLOOR) / (1 - FLOOR));
}

export function rootMeanSquare(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (Number.isFinite(s)) sum += s * s;
  }
  return clamp01(Math.sqrt(sum / samples.length));
}

// -60 dBFS maps to 0 and -6 dBFS to 1.
export function loudnessFromRms(rms) {
  if (!(rms > 0)) return 0;
  return clamp01((20 * Math.log10(rms) + 60) / 54);
}

// Exponential, so the result depends on elapsed time and not on how many frames it took.
export function stepEnvelope(current, target, dt, attack, release) {
  if (!(dt > 0)) return current;
  const goal = clamp01(target);
  const tau = goal > current ? attack : release;
  return current + (goal - current) * (1 - Math.exp(-dt / tau));
}

export function createFrame() {
  return {
    bass: 0,
    mid: 0,
    high: 0,
    loud: 0,
    profile: new Float32Array(PROFILE_BANDS),
    wave: new Float32Array(WAVE_POINTS),
  };
}

export function silenceFrame(frame) {
  frame.bass = frame.mid = frame.high = frame.loud = 0;
  frame.profile.fill(0);
  frame.wave.fill(0);
}

export function readFrame(freq, time, sampleRate, fftSize, frame) {
  frame.bass = bandEnergy(freq, sampleRate, fftSize, BASS[0], BASS[1]);
  frame.mid = bandEnergy(freq, sampleRate, fftSize, MID[0], MID[1]);
  frame.high = bandEnergy(freq, sampleRate, fftSize, HIGH[0], HIGH[1]);
  frame.loud = loudnessFromRms(rootMeanSquare(time));
  for (let k = 0; k < PROFILE_BANDS; k++) {
    frame.profile[k] = bandEnergy(freq, sampleRate, fftSize, PROFILE_EDGES[k], PROFILE_EDGES[k + 1]);
  }
  const block = time.length / WAVE_POINTS;
  for (let p = 0; p < WAVE_POINTS; p++) {
    let sum = 0;
    const from = Math.floor(p * block);
    const to = Math.floor((p + 1) * block);
    for (let i = from; i < to; i++) if (Number.isFinite(time[i])) sum += time[i];
    frame.wave[p] = to > from ? Math.max(-1, Math.min(1, sum / (to - from))) : 0;
  }
}

export function createSignalModel() {
  return { bass: 0, mid: 0, high: 0, loud: 0, pulse: 0, baseline: 0, profile: new Float32Array(PROFILE_BANDS) };
}

export function updateSignal(model, frame, dt) {
  model.bass = settle(stepEnvelope(model.bass, frame.bass, dt, 0.03, 0.32));
  model.mid = settle(stepEnvelope(model.mid, frame.mid, dt, 0.04, 0.38));
  model.high = settle(stepEnvelope(model.high, frame.high, dt, 0.012, 0.16));
  model.loud = settle(stepEnvelope(model.loud, frame.loud, dt, 0.02, 0.3));
  for (let k = 0; k < PROFILE_BANDS; k++) {
    model.profile[k] = settle(stepEnvelope(model.profile[k], frame.profile[k], dt, 0.05, 0.45));
  }
  // A transient is level rising above its own recent average.
  const level = clamp01(frame.loud);
  const impulse = clamp01((level - model.baseline - 0.06) * 3);
  model.pulse = settle(stepEnvelope(model.pulse, impulse, dt, 0.008, 0.3));
  model.baseline = settle(stepEnvelope(model.baseline, level, dt, 0.22, 0.22));
}

export function isAtRest(model) {
  return !(model.bass || model.mid || model.high || model.loud || model.pulse || model.profile.some(Boolean));
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function resolveMediaSource(raw, pageHref) {
  if (typeof raw !== "string" || !raw.trim()) return { kind: "none" };
  let url;
  let page;
  try {
    page = new URL(pageHref);
    url = new URL(raw.trim(), page);
  } catch {
    return { kind: "invalid", reason: "The video address in config.js is not a valid URL." };
  }
  const web = url.protocol === "https:" || url.protocol === "http:";
  const sameOrigin = web && url.origin === page.origin;
  const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol === "https:" || sameOrigin || local) return { kind: "ok", url: url.href };
  return { kind: "invalid", reason: "The video address in config.js must be a relative path or use HTTPS." };
}
