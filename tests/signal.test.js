import test from "node:test";
import assert from "node:assert/strict";
import {
  bandEnergy,
  rootMeanSquare,
  loudnessFromRms,
  stepEnvelope,
  createFrame,
  readFrame,
  createSignalModel,
  updateSignal,
  isAtRest,
  formatTime,
  resolveMediaSource,
} from "../signal.js";

const SR = 48000;
const FFT = 2048;
const binOf = (hz) => Math.round((hz * FFT) / SR);
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

function spectrum(hzLo, hzHi, value = 255) {
  const data = new Uint8Array(FFT / 2);
  for (let i = binOf(hzLo); i <= binOf(hzHi); i++) data[i] = value;
  return data;
}

test("bandEnergy reports only energy inside the requested band", () => {
  const bassOnly = spectrum(40, 170);
  assert.ok(bandEnergy(bassOnly, SR, FFT, 30, 180) > 0.9);
  assert.equal(bandEnergy(bassOnly, SR, FFT, 180, 2200), 0);
  assert.equal(bandEnergy(bassOnly, SR, FFT, 2200, 12000), 0);
});

test("bandEnergy is 0 for silence, 1 at full scale, and safe on bad input", () => {
  assert.equal(bandEnergy(new Uint8Array(1024), SR, FFT, 30, 180), 0);
  assert.equal(bandEnergy(new Uint8Array(1024).fill(255), SR, FFT, 30, 180), 1);
  assert.equal(bandEnergy(new Uint8Array(1024).fill(255), 0, FFT, 30, 180), 0);
  assert.equal(bandEnergy(new Uint8Array(1024).fill(255), NaN, FFT, 30, 180), 0);
  assert.equal(bandEnergy(new Uint8Array(0), SR, FFT, 30, 180), 0);
});

test("bandEnergy notices a single strong partial in a wide band", () => {
  const data = new Uint8Array(1024);
  data[binOf(440)] = 220;
  assert.ok(bandEnergy(data, SR, FFT, 180, 2200) > 0.3);
});

test("a low sample rate cannot report energy above Nyquist", () => {
  const data = new Uint8Array(1024).fill(255);
  assert.equal(bandEnergy(data, 8000, 2048, 5000, 12000), 0);
});

test("rootMeanSquare measures a sine and ignores junk", () => {
  const sine = Float32Array.from({ length: 4800 }, (_, i) => Math.sin((2 * Math.PI * 100 * i) / SR));
  near(rootMeanSquare(sine), Math.SQRT1_2, 1e-3);
  assert.equal(rootMeanSquare(new Float32Array(16)), 0);
  assert.equal(rootMeanSquare(new Float32Array(0)), 0);
  assert.equal(rootMeanSquare(Float32Array.of(NaN, Infinity, 0, 0)), 0);
  assert.equal(rootMeanSquare(new Float32Array(8).fill(4)), 1);
});

test("loudnessFromRms stays within 0 to 1 and rises with level", () => {
  assert.equal(loudnessFromRms(0), 0);
  assert.equal(loudnessFromRms(-1), 0);
  assert.equal(loudnessFromRms(NaN), 0);
  assert.equal(loudnessFromRms(1e-6), 0);
  assert.equal(loudnessFromRms(1), 1);
  assert.ok(loudnessFromRms(0.1) > loudnessFromRms(0.01));
});

test("stepEnvelope does not depend on frame time", () => {
  let oneBig = stepEnvelope(0, 1, 0.1, 0.05, 0.3);
  let manySmall = 0;
  for (let i = 0; i < 10; i++) manySmall = stepEnvelope(manySmall, 1, 0.01, 0.05, 0.3);
  near(oneBig, manySmall, 1e-9);

  let down = 1;
  for (let i = 0; i < 100; i++) down = stepEnvelope(down, 0, 0.001, 0.05, 0.3);
  near(down, stepEnvelope(1, 0, 0.1, 0.05, 0.3), 1e-9);
});

test("stepEnvelope attacks faster than it releases and rejects junk", () => {
  const up = stepEnvelope(0, 1, 0.02, 0.02, 0.4);
  const down = 1 - stepEnvelope(1, 0, 0.02, 0.02, 0.4);
  assert.ok(up > down);
  assert.equal(stepEnvelope(0.5, 1, NaN, 0.02, 0.4), 0.5);
  assert.equal(stepEnvelope(0.5, 1, -1, 0.02, 0.4), 0.5);
  assert.equal(stepEnvelope(0.5, NaN, 0.02, 0.02, 0.4), stepEnvelope(0.5, 0, 0.02, 0.02, 0.4));
});

test("readFrame separates bands, reads loudness and clamps the waveform", () => {
  const frame = createFrame();
  const time = new Float32Array(FFT);
  for (let i = 0; i < FFT; i++) time[i] = 3 * Math.sin((2 * Math.PI * i) / 256);
  time[10] = NaN;
  readFrame(spectrum(60, 150), time, SR, FFT, frame);
  assert.ok(frame.bass > 0.7); // fills 4 of the 6 bass bins
  assert.equal(frame.mid, 0);
  assert.equal(frame.high, 0);
  assert.equal(frame.loud, 1);
  for (const v of frame.wave) assert.ok(Number.isFinite(v) && v >= -1 && v <= 1);
  assert.ok(frame.wave.some((v) => Math.abs(v) > 0.5));
});

test("readFrame maps pitch across the mid profile", () => {
  const frame = createFrame();
  const time = new Float32Array(FFT);
  readFrame(spectrum(200, 230), time, SR, FFT, frame);
  const low = frame.profile[0];
  const top = frame.profile[frame.profile.length - 1];
  assert.ok(low > 0.5);
  assert.equal(top, 0);
  readFrame(spectrum(1800, 2100), time, SR, FFT, frame);
  assert.equal(frame.profile[0], 0);
  assert.ok(frame.profile[frame.profile.length - 1] > 0.5);
});

test("silence never moves the model", () => {
  const model = createSignalModel();
  const frame = createFrame();
  for (let i = 0; i < 300; i++) updateSignal(model, frame, 1 / 60);
  for (const key of ["bass", "mid", "high", "loud", "pulse"]) assert.equal(model[key], 0);
  assert.ok(isAtRest(model));
});

test("a transient raises a clamped pulse which fades on a steady tone", () => {
  const model = createSignalModel();
  const frame = createFrame();
  frame.loud = 0.8;
  frame.bass = 0.7;
  let peak = 0;
  for (let i = 0; i < 12; i++) {
    updateSignal(model, frame, 1 / 60);
    peak = Math.max(peak, model.pulse);
  }
  assert.ok(peak > 0.3, `peak ${peak}`);
  assert.ok(peak <= 1);
  for (let i = 0; i < 300; i++) updateSignal(model, frame, 1 / 60);
  assert.ok(model.pulse < 0.01, `pulse ${model.pulse}`);
  assert.ok(model.loud > 0.7, "steady tone keeps its level");
});

test("the pulse does not fire when level falls", () => {
  const model = createSignalModel();
  const frame = createFrame();
  frame.loud = 0.8;
  for (let i = 0; i < 300; i++) updateSignal(model, frame, 1 / 60);
  frame.loud = 0.1;
  for (let i = 0; i < 60; i++) {
    updateSignal(model, frame, 1 / 60);
    assert.ok(model.pulse < 0.01);
  }
});

test("the model settles to exact zero after sound stops", () => {
  const model = createSignalModel();
  const frame = createFrame();
  frame.bass = frame.mid = frame.high = frame.loud = 1;
  frame.profile.fill(1);
  for (let i = 0; i < 120; i++) updateSignal(model, frame, 1 / 60);
  assert.ok(!isAtRest(model));
  const silent = createFrame();
  for (let i = 0; i < 600; i++) updateSignal(model, silent, 1 / 60);
  assert.ok(isAtRest(model));
  for (const key of ["bass", "mid", "high", "loud", "pulse"]) assert.equal(model[key], 0);
  assert.ok(model.profile.every((v) => v === 0));
});

test("settling takes the same time at 24 and 120 frames per second", () => {
  const settle = (fps) => {
    const model = createSignalModel();
    const loud = createFrame();
    loud.loud = loud.bass = 1;
    updateSignal(model, loud, 1);
    const silent = createFrame();
    let t = 0;
    while (!isAtRest(model) && t < 20) {
      updateSignal(model, silent, 1 / fps);
      t += 1 / fps;
    }
    return t;
  };
  near(settle(24), settle(120), 0.1);
});

test("hostile frame values stay clamped and finite", () => {
  const model = createSignalModel();
  const frame = { bass: NaN, mid: Infinity, high: -5, loud: 40, profile: new Float32Array(8).fill(9), wave: new Float32Array(4) };
  for (let i = 0; i < 60; i++) updateSignal(model, frame, 1 / 60);
  for (const key of ["bass", "mid", "high", "loud", "pulse"]) {
    assert.ok(model[key] >= 0 && model[key] <= 1, `${key} ${model[key]}`);
  }
  assert.ok(model.profile.every((v) => v >= 0 && v <= 1));
  updateSignal(model, createFrame(), NaN);
  assert.ok(Number.isFinite(model.loud));
});

test("formatTime shows real values and is honest about unknown ones", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(9.9), "0:09");
  assert.equal(formatTime(184), "3:04");
  assert.equal(formatTime(3661), "1:01:01");
  for (const unknown of [NaN, Infinity, -1, undefined, null]) assert.equal(formatTime(unknown), "--:--");
});

const PAGE = "https://example.github.io/afterimage/";

test("resolveMediaSource treats an empty value as no media", () => {
  for (const raw of ["", "   ", undefined, null, 42]) assert.equal(resolveMediaSource(raw, PAGE).kind, "none");
});

test("resolveMediaSource keeps relative paths under the Pages subdirectory", () => {
  const relative = resolveMediaSource("./media/recording.mp4", PAGE);
  assert.equal(relative.kind, "ok");
  assert.equal(relative.url, "https://example.github.io/afterimage/media/recording.mp4");
  assert.equal(resolveMediaSource("media/a.mp4", PAGE + "index.html").url, "https://example.github.io/afterimage/media/a.mp4");
});

test("resolveMediaSource allows HTTPS and local development only", () => {
  assert.equal(resolveMediaSource("https://cdn.example.com/a.mp4", PAGE).kind, "ok");
  assert.equal(resolveMediaSource("http://localhost:8000/a.mp4", PAGE).kind, "ok");
  assert.equal(resolveMediaSource("http://127.0.0.1:8000/a.mp4", PAGE).kind, "ok");
  assert.equal(resolveMediaSource("./a.mp4", "http://localhost:8000/").kind, "ok");
  assert.equal(resolveMediaSource("http://cdn.example.com/a.mp4", PAGE).kind, "invalid");
  assert.equal(resolveMediaSource("http://localhost.evil.com/a.mp4", PAGE).kind, "invalid");
  assert.equal(resolveMediaSource("javascript:alert(1)", PAGE).kind, "invalid");
  assert.equal(resolveMediaSource("data:video/mp4;base64,AAAA", PAGE).kind, "invalid");
  assert.equal(resolveMediaSource("file:///etc/passwd", PAGE).kind, "invalid");
  assert.equal(resolveMediaSource("https://", PAGE).kind, "invalid");
});
