import { MEDIA_SOURCE } from "./config.js";
import { createAudioRoute } from "./audio.js";
import { createSculpture } from "./sculpture.js";
import { createFrame, createSignalModel, formatTime, isAtRest, resolveMediaSource, silenceFrame, updateSignal } from "./signal.js";

const $ = (id) => document.getElementById(id);
const video = $("video");
const playButton = $("play");
const seek = $("seek");
const elapsed = $("elapsed");
const durationText = $("duration");
const muteButton = $("mute");
const volumeInput = $("volume");
const statusText = $("status");
const retryButton = $("retry");
const fileInput = $("file");
const noteTitle = $("note-title");
const notePrivacy = $("note-privacy");
const wrap = $("canvas-wrap");

const route = createAudioRoute(video, window.AudioContext || window.webkitAudioContext);
const sculpture = createSculpture($("art"));
const model = createSignalModel();
const frame = createFrame();

let source = null; // { url, name, local }
let failed = false;
let metadataReady = false;
let playToken = 0; // bumped by every newer intent, so older promises and timers can tell they are stale
let pauseMessage = "";
let analysisNote = "";
let contextHooked = false;
let contextRan = false;
let scrubbing = false;
let waitTimer = 0;
let audioWatch = 0;
let volume = 1;
let muted = false;
let lastStatus = "";
let lastValueText = "";

/* Status: announced through a live region, so only meaningful changes reach it. */

function setStatus(message, tone = "") {
  const text = [message, analysisNote].filter(Boolean).join(" ");
  statusText.dataset.tone = tone;
  if (text !== lastStatus) statusText.textContent = lastStatus = text;
}

/* Controls */

const hasSeekableDuration = () => Number.isFinite(video.duration) && video.duration > 0;

function syncControls() {
  const playing = !video.paused && !video.ended && Boolean(source);
  playButton.textContent = playing ? "Pause" : video.ended ? "Replay" : "Play";
  // Stays enabled before metadata: iOS may not load any until play is pressed.
  playButton.disabled = !source || failed;
  seek.disabled = failed || !metadataReady || !hasSeekableDuration();
  retryButton.hidden = !(source && failed);
  document.body.dataset.state = failed ? "error" : !source ? "empty" : playing ? "playing" : "ready";
}

function setFill(input, ratio) {
  input.style.setProperty("--fill", `${Math.max(0, Math.min(1, ratio)) * 100}%`);
}

function syncTime() {
  const known = metadataReady && hasSeekableDuration();
  const time = metadataReady ? video.currentTime : NaN;
  const shown = scrubbing ? Number(seek.value) : time;
  elapsed.textContent = formatTime(shown);
  durationText.textContent = formatTime(known ? video.duration : NaN);
  if (known) {
    seek.max = String(video.duration);
    if (!scrubbing) seek.value = String(time);
    setFill(seek, shown / video.duration);
  } else {
    seek.value = "0";
    setFill(seek, 0);
  }
  const valueText = known ? `${formatTime(shown)} of ${formatTime(video.duration)}` : source ? "Length not known yet" : "No recording loaded";
  if (valueText !== lastValueText) {
    lastValueText = valueText;
    seek.setAttribute("aria-valuetext", valueText);
  }
}

function syncVolume() {
  route.setLevel(volume, muted);
  muteButton.setAttribute("aria-pressed", String(muted));
  volumeInput.value = String(volume);
  setFill(volumeInput, muted ? 0 : volume);
  volumeInput.setAttribute("aria-valuetext", muted ? "Muted" : `${Math.round(volume * 100)}%`);
}

function toggleMute() {
  muted = !muted;
  if (!muted && volume === 0) volume = 0.8;
  syncVolume();
}

/* Source */

function setSource(next) {
  playToken++;
  clearTimeout(waitTimer);
  clearTimeout(audioWatch);
  const previousUrl = source?.url;
  const previousLocal = source?.local;
  source = next;
  failed = false;
  metadataReady = false;
  pauseMessage = "";
  video.pause();
  video.crossOrigin = "anonymous"; // must be set before src, or analysis of remote media goes silent
  video.src = next.url;
  video.load(); // loads metadata only, playback waits for a deliberate action
  if (previousLocal && previousUrl !== next.url) URL.revokeObjectURL(previousUrl);
  noteTitle.textContent = next.name;
  notePrivacy.hidden = !next.local;
  setStatus("Loading video details.");
  syncControls();
  syncTime();
  requestFrames();
}

function explainError() {
  const code = video.error?.code;
  if (code === 1) return; // aborted by a newer load
  playToken++;
  failed = true;
  metadataReady = false;
  clearTimeout(waitTimer);
  clearTimeout(audioWatch);
  let message;
  if (source?.local) {
    message = code === 2
      ? "Reading that file failed. Choose it again."
      : "This browser can't play that file. MP4 with H.264 video and AAC audio plays most widely.";
  } else if (code === 2) {
    message = "The video stopped loading because of a network problem.";
  } else {
    message = "The video didn't load. Check that the address exists, the format is MP4 (H.264 and AAC) and another host sends CORS headers.";
  }
  setStatus(message, "error");
  syncControls();
  syncTime();
  requestFrames();
}

/* Playback */

function hookContext(context) {
  if (contextHooked || !context) return;
  contextHooked = true;
  context.addEventListener("statechange", () => {
    if (context.state === "running") {
      contextRan = true;
      requestFrames();
    } else if (contextRan && !video.paused) {
      // A suspended graph means silent video, which would look like playback but isn't.
      pauseMessage = "Audio was interrupted. Press play to continue.";
      video.pause();
    }
  });
}

function startPlayback() {
  const token = ++playToken;
  clearTimeout(audioWatch);
  pauseMessage = "";

  // All of this runs synchronously inside the click or key press, as Safari requires.
  route.ensure();
  hookContext(route.context);
  if (!route.analyser && !analysisNote) {
    analysisNote = "The form can't follow sound in this browser, so it stays at rest. Audio still plays.";
    if (!route.context) analysisNote += " Volume may follow your device.";
  }
  syncVolume();
  let resuming;
  try {
    resuming = route.resume();
  } catch (error) {
    resuming = Promise.reject(error);
  }
  resuming.catch(() => {
    if (token === playToken) setStatus("Audio couldn't start. Press play to try again.", "error");
  });
  const attempt = video.play();
  requestFrames();

  Promise.resolve(attempt).then(
    () => {
      if (token !== playToken || !route.context || route.context.state === "running") return;
      audioWatch = setTimeout(() => {
        if (token !== playToken || route.context.state === "running" || video.paused) return;
        pauseMessage = "Audio didn't start. Press play to try again.";
        video.pause();
      }, 1500);
    },
    (error) => {
      if (token !== playToken || error?.name === "AbortError") return;
      if (error?.name === "NotAllowedError") {
        setStatus("The browser blocked playback. Press play to try again.", "error");
      } else if (error?.name !== "NotSupportedError") {
        // NotSupportedError also fires the element's error event, which explains it in full.
        setStatus("Playback didn't start. Press play to try again.", "error");
      }
      syncControls();
    },
  );
}

function togglePlay() {
  if (!source || failed) return;
  if (video.paused || video.ended) {
    startPlayback();
  } else {
    playToken++;
    clearTimeout(audioWatch);
    video.pause();
  }
}

function seekBy(seconds) {
  if (seek.disabled) return;
  video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
  syncTime();
  syncControls();
}

/* Render loop: runs only while there is something new to draw. */

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let raf = 0;
let lastTick = 0;
let lastDrawn = 0;
let restDrawn = false;
let slowness = 0;
let stride = 1;

const drawOptions = () => (reducedMotion.matches ? { motion: 0.35, calm: true, stride } : { motion: 1, calm: false, stride });

function requestFrames() {
  if (!raf && !document.hidden) raf = requestAnimationFrame(tick);
}

function tick(now) {
  raf = 0;
  if (document.hidden) return;
  const calmFrame = reducedMotion.matches && now - lastDrawn < 1000 / 24;
  const sounding = !video.paused && !video.ended && Boolean(route.analyser);

  if (calmFrame) {
    if (sounding || !isAtRest(model)) requestFrames();
    return;
  }
  // Capped, so returning from a hidden tab or a long stall can't jump the form.
  const dt = lastTick ? Math.min(0.1, (now - lastTick) / 1000) : 1 / 60;
  lastTick = now;
  lastDrawn = now;

  const live = sounding && route.read(frame);
  if (!live) silenceFrame(frame);
  updateSignal(model, frame, dt);

  const atRest = isAtRest(model);
  if (!atRest || !restDrawn) {
    sculpture.draw(model, frame.wave, dt, drawOptions());
    restDrawn = atRest;
  }
  if (live && !reducedMotion.matches && stride === 1) {
    slowness += (dt - slowness) * 0.02;
    if (slowness > 0.03) stride = 2; // shortcut: one step down and never back, fine for one short recording
  }

  if (live || sounding || !atRest) requestFrames();
  else lastTick = 0;
}

let fitted = "";

function fitCanvas() {
  const { width, height } = wrap.getBoundingClientRect();
  if (!(width > 0 && height > 0)) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = `${width}x${height}@${dpr}`;
  if (size === fitted) return;
  fitted = size;
  sculpture.resize(width, height, dpr);
  sculpture.draw(model, frame.wave, 0, drawOptions()); // resizing clears the canvas, so repaint at once
}

/* Events */

$("choose").addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  setSource({ url: URL.createObjectURL(file), name: file.name, local: true });
  fileInput.value = ""; // choosing the same file twice must still fire change
});

playButton.addEventListener("click", togglePlay);
muteButton.addEventListener("click", toggleMute);
retryButton.addEventListener("click", () => setSource(source));

seek.addEventListener("input", () => {
  scrubbing = true;
  video.currentTime = Number(seek.value);
  syncTime();
});
seek.addEventListener("change", () => {
  scrubbing = false;
  syncTime();
  syncControls();
});

volumeInput.addEventListener("input", () => {
  volume = Number(volumeInput.value);
  if (volume > 0) muted = false;
  syncVolume();
});

video.addEventListener("loadedmetadata", () => {
  metadataReady = true;
  if (video.paused) setStatus("Ready to play.");
  syncTime();
  syncControls();
});
video.addEventListener("durationchange", syncTime);
video.addEventListener("timeupdate", syncTime);
video.addEventListener("seeked", () => {
  syncTime();
  syncControls();
});
video.addEventListener("play", () => {
  syncControls();
  requestFrames();
});
video.addEventListener("playing", () => {
  clearTimeout(waitTimer);
  setStatus("");
  syncControls();
  requestFrames();
});
video.addEventListener("pause", () => {
  clearTimeout(waitTimer);
  clearTimeout(audioWatch);
  syncControls();
  requestFrames();
  if (!metadataReady || video.ended) return;
  setStatus(pauseMessage || "Paused.", pauseMessage ? "error" : "");
  pauseMessage = "";
});
video.addEventListener("waiting", () => {
  clearTimeout(waitTimer);
  // Short seeks flicker through waiting, and those shouldn't reach a screen reader.
  waitTimer = setTimeout(() => {
    if (!video.paused) setStatus("Buffering.");
  }, 500);
});
video.addEventListener("canplay", () => clearTimeout(waitTimer));
video.addEventListener("ended", () => {
  clearTimeout(waitTimer);
  setStatus("Finished. Press replay to hear it again.");
  syncControls();
  requestFrames();
});
video.addEventListener("error", explainError);

// Only when nothing interactive has focus, so native button and slider keys keep working.
const INTERACTIVE = "a, button, input, select, textarea, summary, label, video, audio, [contenteditable], [tabindex]";

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
  const key = event.key.toLowerCase();
  if (key === "m") {
    if (!event.repeat) toggleMute();
  } else if (key === " " || key === "k") {
    if (!source || failed) return;
    if (!event.repeat) togglePlay();
  } else if (key === "arrowleft" || key === "arrowright") {
    if (seek.disabled) return;
    seekBy(key === "arrowleft" ? -5 : 5);
  } else {
    return;
  }
  event.preventDefault();
});

document.addEventListener("visibilitychange", () => {
  lastTick = 0;
  if (document.hidden) {
    cancelAnimationFrame(raf);
    raf = 0;
  } else {
    requestFrames();
  }
});

reducedMotion.addEventListener("change", requestFrames); // the next frame reads the new setting

new ResizeObserver(fitCanvas).observe(wrap);
window.addEventListener("resize", fitCanvas); // also catches a device pixel ratio change, which keeps the same box

/* Start: an honest pending state unless config.js names a recording. */

const configured = resolveMediaSource(MEDIA_SOURCE, document.baseURI);
fitCanvas();
syncVolume();
if (configured.kind === "ok") {
  setSource({ url: configured.url, name: new URL(configured.url).pathname.split("/").pop() || "Recording", local: false });
} else {
  syncControls();
  syncTime();
  if (configured.kind === "invalid") setStatus(configured.reason, "error");
}
