import test from "node:test";
import assert from "node:assert/strict";
import { createAudioRoute } from "../audio.js";
import { createFrame } from "../signal.js";

function fakeContext({ noAnalyser = false, sourceThrows = false } = {}) {
  const log = { contexts: 0, sources: 0, edges: [], closed: 0 };
  const node = (name, extra = {}) => ({
    name,
    connect(to) {
      log.edges.push(`${name}>${to.name}`);
    },
    ...extra,
  });
  class Ctx {
    state = "suspended";
    currentTime = 0;
    sampleRate = 48000;
    destination = { name: "destination" };
    constructor() {
      log.contexts++;
      log.ctx = this;
    }
    createMediaElementSource() {
      if (sourceThrows) throw new Error("nope");
      log.sources++;
      return node("source");
    }
    createAnalyser() {
      if (noAnalyser) throw new Error("nope");
      return node("analyser", {
        fftSize: 0,
        frequencyBinCount: 1024,
        getByteFrequencyData: (d) => d.fill(200),
        getFloatTimeDomainData: (d) => d.fill(0.25),
      });
    }
    createGain() {
      log.gain = node("gain", {
        gain: { value: 1, setTargetAtTime: (v) => (log.gainTarget = v) },
      });
      return log.gain;
    }
    resume() {
      this.state = "running";
      return Promise.resolve();
    }
    close() {
      log.closed++;
    }
  }
  return { Ctx, log };
}

test("the graph is one source through analyser and gain, built once", () => {
  const { Ctx, log } = fakeContext();
  const video = { volume: 0.4, muted: true };
  const route = createAudioRoute(video, Ctx);
  assert.equal(log.contexts, 0, "nothing is created before the first play");
  route.ensure();
  route.ensure();
  route.ensure();
  assert.equal(log.contexts, 1);
  assert.equal(log.sources, 1);
  assert.deepEqual(log.edges, ["source>analyser", "analyser>gain", "gain>destination"]);
  assert.equal(video.volume, 1);
  assert.equal(video.muted, false);
});

test("volume and mute act on the gain and never on the element", () => {
  const { Ctx, log } = fakeContext();
  const video = { volume: 1, muted: false };
  const route = createAudioRoute(video, Ctx);
  route.setLevel(0.3, false);
  assert.equal(video.volume, 1, "level before the graph exists is only remembered");
  route.ensure();
  assert.equal(log.gain.gain.value, 0.3, "remembered level applies when the graph appears");
  route.setLevel(0.6, false);
  assert.equal(log.gainTarget, 0.6);
  route.setLevel(0.6, true);
  assert.equal(log.gainTarget, 0);
  assert.equal(video.volume, 1);
  assert.equal(video.muted, false);
});

test("audio keeps its route when the analyser is unavailable", () => {
  const { Ctx, log } = fakeContext({ noAnalyser: true });
  const route = createAudioRoute({ volume: 1, muted: false }, Ctx);
  route.ensure();
  assert.deepEqual(log.edges, ["source>gain", "gain>destination"]);
  assert.equal(route.analyser, null);
  assert.equal(route.read(createFrame()), false);
});

test("a failed source leaves the element playing natively, with no retry", () => {
  const { Ctx, log } = fakeContext({ sourceThrows: true });
  const video = { volume: 1, muted: false };
  const route = createAudioRoute(video, Ctx);
  route.ensure();
  route.ensure();
  assert.equal(log.contexts, 1);
  assert.equal(log.closed, 1);
  assert.equal(route.context, null);
  route.setLevel(0.5, true);
  assert.equal(video.volume, 0.5);
  assert.equal(video.muted, true);
});

test("a browser with no Web Audio still has working element volume", () => {
  const video = { volume: 1, muted: false };
  const route = createAudioRoute(video, undefined);
  route.ensure();
  route.setLevel(0.2, false);
  assert.equal(video.volume, 0.2);
  assert.equal(route.read(createFrame()), false);
});

test("read only reports data while the context is running", async () => {
  const { Ctx } = fakeContext();
  const route = createAudioRoute({ volume: 1, muted: false }, Ctx);
  route.ensure();
  const frame = createFrame();
  assert.equal(route.read(frame), false);
  assert.equal(frame.loud, 0);
  await route.resume();
  assert.equal(route.read(frame), true);
  assert.ok(frame.bass > 0 && frame.loud > 0);
});
