// The artwork: a taut string with a sheet of silk hanging from it and twisting into folds.
// Every moving term is multiplied by a signal value, so zero signal draws the exact rest pose.

const TAU = Math.PI * 2;
const OCHRE = "216,169,66";
const IVORY = "236,225,207";
const EMBER = "138,106,44";
const WAVE_POINTS = 128;

// Placed by hand around the second fold: [position along silk, distance from it, radius].
const MOTES = [
  [0.27, -1.05, 1.1],
  [0.41, 0.95, 0.9],
  [0.56, -1.55, 1.5],
  [0.64, 1.3, 1],
  [0.72, -1.95, 0.8],
  [0.79, 1.45, 1.3],
  [0.86, -1.15, 0.9],
];

export function buildGeometry(width, height) {
  const portrait = height > width * 1.05;
  const anchor = portrait ? { x: 0.92, y: 0.035 } : { x: 0.93, y: 0.05 };
  const end = portrait ? { x: 0.1, y: 0.6 } : { x: 0.07, y: 0.47 };
  const sag = portrait ? 0.27 : 0.4;
  const belly = Math.min(height * 0.22, width * 0.17);
  const samples = Math.round(Math.min(180, Math.max(110, width / 7)));
  const area = width * height;
  const frontLines = Math.round(Math.min(46, Math.max(26, area / 16000)));
  const backLines = Math.round(frontLines / 2);

  const g = {
    width,
    height,
    belly,
    samples,
    ax: anchor.x * width,
    ay: anchor.y * height,
    bx: end.x * width,
    by: end.y * height,
    u: new Float32Array(samples),
    sx: new Float32Array(samples),
    sy: new Float32Array(samples),
    nx: new Float32Array(samples),
    ny: new Float32Array(samples),
    env: new Float32Array(samples),
    twist: new Float32Array(samples),
    arch: new Float32Array(samples),
    pitch: new Float32Array(samples),
    frontLines,
    backLines,
    frontAlpha: lineAlphas(frontLines, 1),
    backAlpha: lineAlphas(backLines, 0.55),
  };

  for (let i = 0; i < samples; i++) {
    const u = i / (samples - 1);
    const arch = Math.sin(Math.PI * u);
    g.u[i] = u;
    g.arch[i] = arch;
    g.sx[i] = width * (anchor.x + (end.x - anchor.x) * u + 0.035 * Math.sin(TAU * u));
    g.sy[i] = height * (anchor.y + (end.y - anchor.y) * u + sag * Math.sin(Math.PI * u ** 1.35));
    g.env[i] = Math.max(0, arch) ** 0.85 * (0.42 + 0.58 * Math.exp(-(((u - 0.7) / 0.2) ** 2)));
    g.twist[i] = 0.5 + 8.17 * u ** 1.1;
    g.pitch[i] = Math.min(7, (7 * Math.abs(u - 0.7)) / 0.7); // low notes swell the belly, high notes the ends
  }
  for (let i = 0; i < samples; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(samples - 1, i + 1);
    const dx = g.sx[b] - g.sx[a];
    const dy = g.sy[b] - g.sy[a];
    const len = Math.hypot(dx, dy) || 1;
    g.nx[i] = -dy / len;
    g.ny[i] = dx / len;
  }
  return g;
}

function lineAlphas(count, scale) {
  const out = new Float32Array(count);
  for (let l = 0; l < count; l++) {
    const v = lineV(l, count);
    const sheen = Math.pow(0.5 + 0.5 * Math.sin(v * 5 + 1), 3) * 0.17;
    out[l] = scale * (0.09 + 0.46 * Math.abs(v) ** 4 + sheen);
  }
  return out;
}

const lineV = (l, count) => (2 * l) / (count - 1) - 1;

export function createSculpture(canvas) {
  const ctx = canvas.getContext("2d", { alpha: false });
  let g = null;
  let dpr = 1;
  let phase = 0;
  let cx, cy, wide, cos, sin;
  let frontStroke, backStroke, glow;

  function resize(width, height, ratio) {
    dpr = ratio;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    g = buildGeometry(width, height);
    cx = new Float32Array(g.samples);
    cy = new Float32Array(g.samples);
    wide = new Float32Array(g.samples);
    cos = new Float32Array(g.samples);
    sin = new Float32Array(g.samples);

    frontStroke = ctx.createLinearGradient(g.ax, g.ay, g.bx, g.by);
    frontStroke.addColorStop(0, `rgba(${OCHRE},.55)`);
    frontStroke.addColorStop(0.5, `rgba(${IVORY},1)`);
    frontStroke.addColorStop(0.78, `rgba(${OCHRE},1)`);
    frontStroke.addColorStop(1, `rgba(${OCHRE},.5)`);
    backStroke = ctx.createLinearGradient(g.ax, g.ay, g.bx, g.by);
    backStroke.addColorStop(0, `rgba(${EMBER},.6)`);
    backStroke.addColorStop(0.6, `rgba(${OCHRE},1)`);
    backStroke.addColorStop(1, `rgba(${EMBER},.5)`);
    glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    glow.addColorStop(0, `rgba(${OCHRE},1)`);
    glow.addColorStop(0.5, `rgba(${OCHRE},.28)`);
    glow.addColorStop(1, `rgba(${OCHRE},0)`);
  }

  function shape(model, motion) {
    const { bass, profile, pulse } = model;
    const sway = Math.min(g.width, g.height) * 0.07;
    for (let i = 0; i < g.samples; i++) {
      const u = g.u[i];
      const k = g.pitch[i];
      const k0 = k | 0;
      const f = k - k0;
      const note = profile[k0] * (1 - f) + profile[Math.min(7, k0 + 1)] * f;
      const swell = 1 + motion * (0.2 * bass + 0.75 * note + 0.05 * pulse);
      const theta =
        g.twist[i] +
        motion * (0.35 * bass * Math.sin(Math.PI * u + phase * 0.7) + 1.1 * note * Math.sin(phase * 0.6 + 9 * u));
      const drift = motion * bass * sway * g.arch[i] * Math.sin(phase * 0.9 + u * 2.2);
      wide[i] = g.belly * g.env[i] * swell;
      cos[i] = Math.cos(theta);
      sin[i] = Math.sin(theta);
      cx[i] = g.sx[i] + g.nx[i] * drift;
      cy[i] = g.sy[i] + g.ny[i] * drift;
    }
  }

  function sheet(lines, alphas, stride, curl, shear, widthScale, seed, ripple, brightness) {
    const end = g.samples;
    for (let l = 0; l < lines; l += stride) {
      const v = lineV(l, lines);
      const bow = curl * (1 - v * v);
      ctx.beginPath();
      for (let i = 0; i < end; i++) {
        const u = g.u[i];
        const w = wide[i] * widthScale;
        const pleat =
          g.belly * g.env[i] * (0.05 * Math.sin(u * 24 + v * 6.5 + seed) + ripple * Math.sin(u * 61 + v * 11 + phase * 3.1));
        const across = w * (v * cos[i] + bow * sin[i]) + pleat;
        const along = w * shear * v * sin[i];
        const x = cx[i] + g.nx[i] * across + g.ny[i] * along;
        const y = cy[i] + g.ny[i] * across - g.nx[i] * along;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.globalAlpha = Math.min(0.95, alphas[l] * brightness);
      ctx.stroke();
    }
  }

  function halo(x, y, rx, ry, angle, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(rx, ry);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function string(wave, amplitude, loud, pulse) {
    const dx = g.bx - g.ax;
    const dy = g.by - g.ay;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len;
    const py = dx / len;
    ctx.beginPath();
    for (let p = 0; p < WAVE_POINTS; p++) {
      const t = p / (WAVE_POINTS - 1);
      const d = wave[p] * amplitude * Math.sin(Math.PI * t);
      const x = g.ax + dx * t + px * d;
      const y = g.ay + dy * t + py * d;
      if (p === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgb(${IVORY})`;
    ctx.lineWidth = 3.5;
    ctx.globalAlpha = 0.05 + 0.2 * loud;
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.globalAlpha = Math.min(0.98, 0.5 + 0.42 * loud + 0.08 * pulse);
    ctx.stroke();
    ctx.fillStyle = `rgb(${IVORY})`;
    ctx.globalAlpha = 0.8;
    for (const [x, y] of [[g.ax, g.ay], [g.bx, g.by]]) {
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, TAU);
      ctx.fill();
    }
  }

  function motes(high, motion) {
    ctx.fillStyle = `rgb(${IVORY})`;
    for (let m = 0; m < MOTES.length; m++) {
      const [u, off, radius] = MOTES[m];
      const i = Math.round(u * (g.samples - 1));
      const d = g.belly * off + motion * high * 16 * Math.sin(phase * 1.3 + m * 2.4);
      ctx.globalAlpha = Math.min(0.95, 0.3 + 0.6 * high);
      ctx.beginPath();
      ctx.arc(cx[i] + g.nx[i] * d, cy[i] + g.ny[i] * d, radius, 0, TAU);
      ctx.fill();
    }
  }

  // motion is 1 normally and lower for reduced motion. stride 2 draws half the threads on slow devices.
  function draw(model, wave, dt, { motion = 1, calm = false, stride = 1 } = {}) {
    if (!g) return;
    const { bass, mid, high, loud, pulse } = model;
    // The timebase only runs while there is sound, so silence cannot fake any movement.
    phase += dt * (0.25 + 1.4 * mid + 0.8 * bass) * Math.min(1, loud * 4) * motion;
    const flare = calm ? 0 : pulse;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#0f0c09";
    ctx.fillRect(0, 0, g.width, g.height);
    ctx.globalCompositeOperation = "lighter";

    shape(model, motion);

    const i = Math.round(0.68 * (g.samples - 1));
    const j = Math.round(0.36 * (g.samples - 1));
    const tilt = Math.atan2(g.by - g.ay, g.bx - g.ax);
    const r = g.belly * 2.6 * (1 + 0.16 * bass * motion);
    halo(cx[i], cy[i], r, r * 0.6, tilt, 0.09 + 0.15 * loud + 0.06 * flare);
    halo(cx[j], cy[j], r * 0.55, r * 0.36, tilt, 0.04 + 0.08 * mid);

    const brightness = 1 + 0.85 * loud + 0.3 * flare + (stride > 1 ? 0.35 : 0);
    const ripple = 0.1 * high * motion;
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.65;
    ctx.strokeStyle = backStroke;
    sheet(g.backLines, g.backAlpha, stride, -0.52, -0.18, 0.74, 2.1, ripple * 0.6, brightness);
    ctx.lineWidth = 0.7 + 0.25 * loud;
    ctx.strokeStyle = frontStroke;
    sheet(g.frontLines, g.frontAlpha, stride, 0.38, 0.22, 1, 0, ripple, brightness);

    const amplitude = calm ? 0 : Math.min(g.width, g.height) * 0.25;
    string(wave, amplitude, loud, flare);
    motes(high, motion);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  return { resize, draw };
}
