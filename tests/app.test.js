// Drives the real app.js through a small DOM stand-in. Proves wiring and ordering, not rendering.
import test from "node:test";
import assert from "node:assert/strict";

class FakeElement extends EventTarget {
  constructor(id) {
    super();
    this.id = id;
    this.dataset = {};
    this.attributes = {};
    this.style = { setProperty() {} };
    this.value = "";
    this.disabled = false;
    this.hidden = false;
    this.textContent = "";
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  closest(selector) {
    return this.interactive && selector ? this : null;
  }
  click() {
    this.clicked = (this.clicked || 0) + 1;
  }
  getBoundingClientRect() {
    return { width: 1000, height: 500 };
  }
}
globalThis.Element = FakeElement;

const calls = [];

class FakeVideo extends FakeElement {
  paused = true;
  ended = false;
  duration = NaN;
  currentTime = 0;
  volume = 1;
  muted = false;
  error = null;
  crossOrigin = null;
  playResult = () => Promise.resolve();
  set src(url) {
    calls.push(`src:crossOrigin=${this.crossOrigin}`);
    this.currentSrc = url;
  }
  load() {
    calls.push("load");
  }
  pause() {
    this.paused = true;
  }
  play() {
    calls.push("play");
    this.paused = false;
    return this.playResult();
  }
}

const elements = new Map();
const byId = (id) => {
  if (!elements.has(id)) elements.set(id, id === "video" ? new FakeVideo(id) : new FakeElement(id));
  return elements.get(id);
};
byId("art").getContext = () =>
  new Proxy(
    { createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) },
    {
      get: (target, key) => (key in target ? target[key] : () => {}),
      set: () => true,
    },
  );
for (const id of ["play", "seek", "mute", "volume", "choose", "retry"]) byId(id).interactive = true;
byId("volume").value = "1";

const audio = { contexts: 0, sources: 0, resumes: 0 };

class FakeAudioContext extends EventTarget {
  state = "suspended";
  currentTime = 0;
  sampleRate = 48000;
  destination = {};
  constructor() {
    super();
    audio.contexts++;
    audio.ctx = this;
    calls.push("context");
  }
  createMediaElementSource() {
    audio.sources++;
    return { connect() {} };
  }
  createAnalyser() {
    audio.analysed = true;
    return {
      connect() {},
      fftSize: 2048,
      frequencyBinCount: 1024,
      getByteFrequencyData() {},
      getFloatTimeDomainData() {},
    };
  }
  createGain() {
    audio.gain = { connect() {}, gain: { value: 1, setTargetAtTime: (v) => (audio.level = v) } };
    return audio.gain;
  }
  resume() {
    audio.resumes++;
    calls.push("resume");
    this.state = "running";
    return Promise.resolve();
  }
}

const documentStub = new EventTarget();
Object.assign(documentStub, {
  getElementById: byId,
  hidden: false,
  body: new FakeElement("body"),
  baseURI: "https://example.github.io/afterimage/",
});
globalThis.document = documentStub;
globalThis.window = Object.assign(new EventTarget(), {
  AudioContext: FakeAudioContext,
  devicePixelRatio: 3,
  matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
});
globalThis.ResizeObserver = class {
  observe() {}
};
let frames = 0;
let pendingFrame = null;
globalThis.requestAnimationFrame = (callback) => {
  pendingFrame = callback;
  return ++frames;
};
globalThis.cancelAnimationFrame = () => {};
const revoked = [];
let urlCount = 0;
URL.createObjectURL = (file) => `blob:test/${++urlCount}-${file.name}`;
URL.revokeObjectURL = (url) => revoked.push(url);

await import("../app.js");

const video = byId("video");
const key = (name, target = documentStub.body, extra = {}) => {
  const event = Object.assign(new Event("keydown", { cancelable: true }), { key: name, repeat: false, ...extra });
  Object.defineProperty(event, "target", { value: target });
  documentStub.dispatchEvent(event);
  return event;
};
const chooseFile = (name) => {
  byId("file").files = [{ name }];
  byId("file").dispatchEvent(new Event("change"));
};
const metadata = (duration) => {
  video.duration = duration;
  video.dispatchEvent(new Event("loadedmetadata"));
};
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the page opens honest: nothing loaded, nothing created, chooser ready", () => {
  assert.equal(audio.contexts, 0);
  assert.equal(byId("play").disabled, true);
  assert.equal(byId("seek").disabled, true);
  assert.equal(byId("choose").disabled, false);
  assert.equal(byId("duration").textContent, "--:--");
  assert.equal(byId("elapsed").textContent, "--:--");
  assert.equal(calls.length, 0);
  byId("choose").dispatchEvent(new Event("click"));
  assert.equal(byId("file").clicked, 1);
});

test("space and arrows do nothing without media and don't swallow the key", () => {
  assert.equal(key(" ").defaultPrevented, false);
  assert.equal(key("ArrowRight").defaultPrevented, false);
  assert.equal(calls.length, 0);
});

test("choosing a file loads metadata only, with crossOrigin set first", () => {
  chooseFile("<b>take one</b>.mp4");
  assert.deepEqual(calls, ["src:crossOrigin=anonymous", "load"]);
  assert.equal(byId("note-title").textContent, "<b>take one</b>.mp4");
  assert.equal(byId("file").value, "");
  assert.equal(byId("play").disabled, false, "iOS may not load metadata before play");
  assert.equal(byId("seek").disabled, true);
  assert.equal(byId("duration").textContent, "--:--", "no pretend duration");
  metadata(184);
  assert.equal(byId("duration").textContent, "3:04");
  assert.equal(byId("seek").disabled, false);
  assert.equal(audio.contexts, 0, "no audio graph until a deliberate play");
});

test("play builds the graph and calls play synchronously in the same click", () => {
  calls.length = 0;
  byId("play").dispatchEvent(new Event("click"));
  assert.deepEqual(calls, ["context", "resume", "play"]);
  assert.equal(video.volume, 1);
});

test("volume and mute reach the gain, leaving the element at full level", () => {
  byId("volume").value = "0.4";
  byId("volume").dispatchEvent(new Event("input"));
  assert.equal(audio.level, 0.4);
  key("m");
  assert.equal(audio.level, 0);
  assert.equal(byId("mute").attributes["aria-pressed"], "true");
  byId("mute").dispatchEvent(new Event("click"));
  assert.equal(audio.level, 0.4);
  assert.equal(video.volume, 1);
  assert.equal(video.muted, false);
});

test("keyboard: shortcuts respect focus and modifiers", () => {
  video.currentTime = 20;
  assert.equal(key("ArrowRight", byId("seek")).defaultPrevented, false, "slider keeps its own arrows");
  assert.equal(video.currentTime, 20);
  assert.equal(key("ArrowRight", documentStub.body, { altKey: true }).defaultPrevented, false);
  assert.equal(video.currentTime, 20);
  assert.equal(key(" ", byId("play")).defaultPrevented, false, "a focused button handles its own space");
  assert.equal(video.paused, false);

  assert.equal(key("ArrowRight").defaultPrevented, true);
  assert.equal(video.currentTime, 25);
  key("ArrowLeft");
  key("ArrowLeft");
  assert.equal(video.currentTime, 15);
  video.currentTime = 182;
  key("ArrowRight");
  assert.equal(video.currentTime, 184, "seek clamps to the real length");
  video.currentTime = 10;
  key("k");
  assert.equal(video.paused, true);
  key(" ");
  assert.equal(video.paused, false);
});

test("replacing the file reuses the graph and frees the old file", async () => {
  chooseFile("second.mov");
  assert.equal(video.paused, true, "a new file doesn't autoplay");
  assert.deepEqual(revoked, ["blob:test/1-<b>take one</b>.mp4"]);
  assert.equal(byId("duration").textContent, "--:--", "old duration is gone");
  metadata(60);
  byId("play").dispatchEvent(new Event("click"));
  await settled();
  assert.equal(audio.contexts, 1);
  assert.equal(audio.sources, 1);
});

test("a stale play rejection is ignored and a current one is explained", async () => {
  video.pause();
  video.dispatchEvent(new Event("pause"));
  let reject;
  video.playResult = () => new Promise((_, r) => (reject = r));
  byId("play").dispatchEvent(new Event("click"));
  chooseFile("third.mp4");
  metadata(30);
  const before = byId("status").textContent;
  reject(Object.assign(new Error("x"), { name: "NotAllowedError" }));
  await settled();
  assert.equal(byId("status").textContent, before, "the old promise can't touch the new file");

  byId("play").dispatchEvent(new Event("click"));
  reject(Object.assign(new Error("x"), { name: "NotAllowedError" }));
  await settled();
  assert.match(byId("status").textContent, /blocked playback/);
  assert.equal(byId("play").disabled, false, "retry stays possible");
  video.paused = true;
  video.playResult = () => Promise.resolve();
});

test("an interrupted context pauses honestly instead of playing silently", () => {
  byId("play").dispatchEvent(new Event("click"));
  audio.ctx.state = "running";
  audio.ctx.dispatchEvent(new Event("statechange"));
  audio.ctx.state = "interrupted";
  audio.ctx.dispatchEvent(new Event("statechange"));
  assert.equal(video.paused, true);
  video.dispatchEvent(new Event("pause"));
  assert.match(byId("status").textContent, /interrupted/);
  audio.ctx.state = "running";
});

test("a media error disables play and seek, explains, and allows a retry", () => {
  video.error = { code: 4 };
  video.dispatchEvent(new Event("error"));
  assert.equal(byId("play").disabled, true);
  assert.equal(byId("seek").disabled, true);
  assert.equal(byId("retry").hidden, false);
  assert.equal(byId("choose").disabled, false);
  assert.equal(byId("duration").textContent, "--:--");
  assert.match(byId("status").textContent, /can't play that file/);

  video.error = null;
  calls.length = 0;
  byId("retry").dispatchEvent(new Event("click"));
  assert.deepEqual(calls, ["src:crossOrigin=anonymous", "load"]);
  assert.equal(byId("retry").hidden, true);
  assert.equal(byId("play").disabled, false);
  assert.equal(revoked.includes(video.currentSrc), false, "retrying keeps the file usable");
});

test("the render loop runs while sounding and stops once paused and settled", () => {
  let now = 1000;
  const run = (limit) => {
    let count = 0;
    while (pendingFrame && count < limit) {
      const callback = pendingFrame;
      pendingFrame = null;
      callback((now += 16));
      count++;
    }
    return count;
  };
  metadata(30);
  assert.ok(run(2000) < 2000, "paused with no signal: frames stop");
  assert.equal(pendingFrame, null);

  byId("play").dispatchEvent(new Event("click"));
  assert.equal(run(120), 120, "playing keeps reading the analyser");
  assert.ok(pendingFrame);

  video.pause();
  video.dispatchEvent(new Event("pause"));
  assert.ok(run(2000) < 2000, "paused again: frames stop");
  assert.equal(pendingFrame, null);
});
