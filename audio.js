import { readFrame } from "./signal.js";

// One context and one element source for the life of the page; both survive file changes.
// source -> analyser -> gain -> destination. The analyser sits before the gain so that
// volume and mute change what you hear and not the shape.
export function createAudioRoute(video, AudioCtor) {
  let context = null;
  let analyser = null;
  let gain = null;
  let attempted = false;
  let level = 1;
  let freq = null;
  let time = null;

  function ensure() {
    if (attempted) return;
    attempted = true; // a second createMediaElementSource on this element would throw
    if (!AudioCtor) return;
    try {
      context = new AudioCtor();
    } catch {
      context = null;
      return;
    }
    let source;
    try {
      source = context.createMediaElementSource(video);
    } catch {
      context.close?.();
      context = null;
      return;
    }
    // From here the element's output goes through the graph, so it must reach the destination.
    video.volume = 1; // read-only on iOS, which is why level lives on the gain
    video.muted = false;
    gain = context.createGain();
    gain.gain.value = level;
    try {
      const node = context.createAnalyser();
      if (typeof node.getFloatTimeDomainData !== "function") throw new Error("no float data");
      node.fftSize = 2048;
      node.smoothingTimeConstant = 0; // smoothing is ours, in real time rather than per read
      node.minDecibels = -90;
      node.maxDecibels = -20;
      freq = new Uint8Array(node.frequencyBinCount);
      time = new Float32Array(node.fftSize);
      source.connect(node);
      node.connect(gain);
      analyser = node;
    } catch {
      analyser = null;
      source.connect(gain);
    }
    gain.connect(context.destination);
  }

  return {
    ensure,
    get context() {
      return context;
    },
    get analyser() {
      return analyser;
    },
    resume() {
      if (!context || context.state === "running") return Promise.resolve();
      return Promise.resolve(context.resume());
    },
    setLevel(volume, muted) {
      level = muted ? 0 : volume;
      if (gain) {
        gain.gain.setTargetAtTime(level, context.currentTime, 0.012);
      } else if (attempted) {
        // Native output: the only route left. iOS may ignore volume here but honours muted.
        video.volume = volume;
        video.muted = muted;
      }
    },
    read(frame) {
      if (!analyser || context.state !== "running") return false;
      analyser.getByteFrequencyData(freq);
      analyser.getFloatTimeDomainData(time);
      readFrame(freq, time, context.sampleRate, analyser.fftSize, frame);
      return true;
    },
  };
}
