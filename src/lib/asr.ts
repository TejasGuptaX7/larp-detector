// In-browser transcription: tap the ONE shared mic stream, segment it into
// utterances with an energy VAD, and hand each utterance to the Moonshine
// worker (asr.worker.ts). No second getUserMedia (so no mic contention with the
// speaker engine), no API key, no Google backend — works across browsers.

import { audioCtx } from "./audio";
import { getStream } from "./session";
import type { SttHandlers, SttHandle } from "./stt";

const TARGET_SR = 16000;
const SILENCE_MS = 600; // end an utterance after this much trailing silence
const MIN_MS = 350; // ignore blips shorter than this
const MAX_MS = 15_000; // force-cut very long utterances

type WorkerMsg =
  | { type: "progress"; data?: { progress?: number; status?: string } }
  | { type: "ready"; device: string }
  | { type: "error"; error: string }
  | { type: "result"; id: number; text: string; error?: string };

export function startAsr(h: SttHandlers): SttHandle {
  const stream = getStream();
  if (!stream) {
    h.onStatus?.("error", "no-mic");
    return { stop: () => {} };
  }
  const ac = audioCtx();
  let stopped = false;
  let ready = false;
  let reqId = 0;

  const worker = new Worker(new URL("./asr.worker.ts", import.meta.url), {
    type: "module",
  });

  h.onStatus?.("loading", "0%");
  worker.postMessage({ type: "load" });

  worker.onmessage = (e: MessageEvent<WorkerMsg>) => {
    const m = e.data;
    if (m.type === "progress") {
      if (typeof m.data?.progress === "number") {
        h.onStatus?.("loading", `${Math.round(m.data.progress)}%`);
      }
    } else if (m.type === "ready") {
      ready = true;
      h.onStatus?.("listening", "on-device");
    } else if (m.type === "error") {
      // Model couldn't load — let the caller fall back to another engine.
      h.onStatus?.("error", "asr-unavailable");
      h.onError?.("asr-unavailable");
    } else if (m.type === "result") {
      h.onInterim("");
      if (m.text) h.onFinal(m.text);
    }
  };

  // ---- capture + energy VAD off the shared graph ----
  const src = ac.createMediaStreamSource(stream);
  const proc = ac.createScriptProcessor(4096, 1, 1);
  const mute = ac.createGain();
  mute.gain.value = 0; // sink so the node runs without echoing the mic
  src.connect(proc);
  proc.connect(mute);
  mute.connect(ac.destination);

  const sr = ac.sampleRate;
  const bufMs = (4096 / sr) * 1000;
  const silenceBuffers = Math.max(2, Math.ceil(SILENCE_MS / bufMs));

  let noiseFloor = 0.01;
  let speaking = false;
  let silent = 0;
  let seg: Float32Array[] = [];
  let segMs = 0;

  proc.onaudioprocess = (ev) => {
    if (stopped || !ready) return;
    const input = ev.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);

    // Track the noise floor while quiet; threshold sits a few x above it.
    if (!speaking) {
      noiseFloor =
        rms < noiseFloor ? rms * 0.5 + noiseFloor * 0.5 : noiseFloor * 0.995 + rms * 0.005;
    }
    const thresh = Math.max(0.015, noiseFloor * 3);

    if (rms > thresh) {
      if (!speaking) {
        speaking = true;
        seg = [];
        segMs = 0;
        h.onInterim("…");
      }
      silent = 0;
      seg.push(new Float32Array(input));
      segMs += bufMs;
      if (segMs >= MAX_MS) endSegment();
    } else if (speaking) {
      seg.push(new Float32Array(input));
      segMs += bufMs;
      if (++silent >= silenceBuffers) endSegment();
    }
  };

  function endSegment() {
    const ms = segMs;
    const chunks = seg;
    speaking = false;
    silent = 0;
    seg = [];
    segMs = 0;
    if (ms < MIN_MS) {
      h.onInterim("");
      return;
    }
    let len = 0;
    for (const c of chunks) len += c.length;
    const pcm = new Float32Array(len);
    let o = 0;
    for (const c of chunks) {
      pcm.set(c, o);
      o += c.length;
    }
    const ds = downsample(pcm, sr, TARGET_SR);
    worker.postMessage({ type: "transcribe", id: ++reqId, audio: ds }, [ds.buffer]);
  }

  return {
    stop: () => {
      stopped = true;
      h.onStatus?.("off");
      try {
        proc.onaudioprocess = null;
        proc.disconnect();
        src.disconnect();
        mute.disconnect();
      } catch {
        /* noop */
      }
      try {
        worker.terminate();
      } catch {
        /* noop */
      }
    },
  };
}

/** Linear-interpolation downsample to the model's 16 kHz input. */
function downsample(buf: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return buf;
  const ratio = from / to;
  const outLen = Math.floor(buf.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const i1 = Math.min(buf.length - 1, i0 + 1);
    const frac = idx - i0;
    out[i] = buf[i0] * (1 - frac) + buf[i1] * frac;
  }
  return out;
}
