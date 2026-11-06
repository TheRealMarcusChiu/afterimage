import test from "node:test";
import assert from "node:assert/strict";
import { buildGeometry, createSculpture } from "../sculpture.js";
import { createSignalModel, createFrame } from "../signal.js";

function fakeCanvas() {
  const points = [];
  const gradient = () => ({ addColorStop() {} });
  const ctx = new Proxy(
    {
      points,
      strokes: 0,
      moveTo: (x, y) => points.push(x, y),
      lineTo: (x, y) => points.push(x, y),
      arc: (x, y) => points.push(x, y),
      stroke() {
        ctx.strokes++;
      },
      createLinearGradient: gradient,
      createRadialGradient: gradient,
    },
    {
      get: (target, key) => (key in target ? target[key] : () => {}),
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    },
  );
  return { canvas: { getContext: () => ctx, width: 0, height: 0 }, ctx, points };
}

const SIZES = [
  [1265, 560],
  [320, 300],
  [390, 620],
  [844, 200],
  [2560, 1100],
];

test("the rest pose is finite, stays on canvas and is asymmetric", () => {
  for (const [w, h] of SIZES) {
    const g = buildGeometry(w, h);
    let lowest = -Infinity;
    let lowestX = 0;
    for (let i = 0; i < g.samples; i++) {
      for (const value of [g.sx[i], g.sy[i], g.nx[i], g.ny[i], g.env[i], g.twist[i]]) assert.ok(Number.isFinite(value));
      assert.ok(g.sx[i] >= 0 && g.sx[i] <= w, `x at ${w}x${h}`);
      assert.ok(g.sy[i] + g.belly * g.env[i] <= h, `belly at ${w}x${h}`);
      if (g.sy[i] > lowest) {
        lowest = g.sy[i];
        lowestX = g.sx[i];
      }
    }
    assert.ok(Math.abs(lowestX - w / 2) > w * 0.03, `lowest point off-centre at ${w}x${h}`);
    assert.ok(g.frontLines <= 46 && g.samples <= 180, "geometry stays capped");
  }
});

test("silence draws the same pose however much time passes", () => {
  const { canvas, points } = fakeCanvas();
  const sculpture = createSculpture(canvas);
  sculpture.resize(1000, 500, 2);
  const model = createSignalModel();
  const frame = createFrame();
  sculpture.draw(model, frame.wave, 0);
  const first = [...points];
  points.length = 0;
  sculpture.draw(model, frame.wave, 30);
  assert.deepEqual(points, first);
});

test("real signal moves the form, and it returns to the exact rest pose", () => {
  const { canvas, points } = fakeCanvas();
  const sculpture = createSculpture(canvas);
  sculpture.resize(1000, 500, 1);
  const rest = createSignalModel();
  const frame = createFrame();
  sculpture.draw(rest, frame.wave, 0);
  const first = [...points];

  const loud = createSignalModel();
  Object.assign(loud, { bass: 1, mid: 1, high: 1, loud: 1, pulse: 1 });
  loud.profile.fill(1);
  const wave = new Float32Array(128).fill(0.5);
  for (let i = 0; i < 40; i++) {
    points.length = 0;
    sculpture.draw(loud, wave, 1 / 60);
  }
  assert.ok(points.every(Number.isFinite));
  assert.notDeepEqual(points, first);

  points.length = 0;
  sculpture.draw(rest, frame.wave, 1 / 60);
  assert.deepEqual(points, first);
});

test("reduced motion moves less, and slow devices draw fewer threads", () => {
  const measure = (options) => {
    const { canvas, ctx, points } = fakeCanvas();
    const sculpture = createSculpture(canvas);
    sculpture.resize(1000, 500, 1);
    const frame = createFrame();
    sculpture.draw(createSignalModel(), frame.wave, 0, options);
    const first = [...points];
    const strokes = ctx.strokes;
    points.length = 0;
    const loud = createSignalModel();
    Object.assign(loud, { bass: 1, mid: 1, high: 1, loud: 1 });
    loud.profile.fill(1);
    sculpture.draw(loud, new Float32Array(128).fill(0.5), 1 / 24, options);
    let shift = 0;
    for (let i = 0; i < first.length; i++) shift += Math.abs(points[i] - first[i]);
    return { shift, strokes };
  };
  const full = measure({});
  const calm = measure({ motion: 0.35, calm: true });
  const slow = measure({ stride: 2 });
  assert.ok(calm.shift < full.shift * 0.6, `${calm.shift} vs ${full.shift}`);
  assert.ok(slow.strokes < full.strokes * 0.7);
});
