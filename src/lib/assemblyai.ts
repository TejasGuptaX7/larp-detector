// Realtime transcription via AssemblyAI Universal-Streaming. Fast (sub-second
// finals) and accurate — replaces the in-browser model when a key is configured.
//
// The browser opens the WebSocket DIRECTLY with a short-lived token minted by our
// server (/api/aai-token); the long-lived key never reaches the client. Audio is
// captured off the ONE shared mic stream (no second getUserMedia), downsampled to
// 16 kHz PCM16, and streamed continuously — AssemblyAI handles endpointing, so
// finals arrive within a few hundred ms of a pause. Speaker attribution still
// comes from our own voice gateway; this only supplies the words.

import { audioCtx } from "./audio";
import { getStream } from "./session";
import type { SttHandlers, SttHandle } from "./stt";

const TARGET_SR = 16000;

type TurnMsg = {
  type: "Begin" | "Turn" | "Termination";
  transcript?: string;
  end_of_turn?: boolean;
  turn_is_formatted?: boolean;
};

export function startAssemblyAI(h: SttHandlers, token: string): SttHandle {
  const stream = getStream();
  if (!stream) {
    h.onStatus?.("error", "no-mic");
    return { stop: () => {} };
  }
  const ac = audioCtx();
  let stopped = false;

  const url =
    `wss://streaming.assemblyai.com/v3/ws` +
    `?sample_rate=${TARGET_SR}&encoding=pcm_s16le&format_turns=true` +
    `&token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  h.onStatus?.("loading");

  // If we don't hear back within a few seconds the token/connection is bad —
  // bail so the caller can fall back instead of hanging on a dead socket.
  let connected = false;
  const watchdog = window.setTimeout(() => {
    if (!connected && !stopped) {
      h.onStatus?.("error", "assemblyai");
      h.onError?.("assemblyai");
      try {
        ws.close();
      } catch {
        /* noop */
      }
    }
  }, 6000);

  let src: MediaStreamAudioSourceNode | null = null;
  let proc: ScriptProcessorNode | null = null;
  let mute: GainNode | null = null;

  ws.onopen = () => {
    if (stopped) {
      try {
        ws.close();
      } catch {
        /* noop */
      }
      return;
    }
    src = ac.createMediaStreamSource(stream);
    proc = ac.createScriptProcessor(4096, 1, 1);
    mute = ac.createGain();
    mute.gain.value = 0;
    src.connect(proc);
    proc.connect(mute);
    mute.connect(ac.destination);
    const sr = ac.sampleRate;
    proc.onaudioprocess = (ev) => {
      if (stopped || ws.readyState !== WebSocket.OPEN) return;
      ws.send(to16kPcm(ev.inputBuffer.getChannelData(0), sr));
    };
  };

  ws.onmessage = (e) => {
    if (typeof e.data !== "string") return;
    let m: TurnMsg;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m.type === "Begin") {
      connected = true;
      clearTimeout(watchdog);
      h.onStatus?.("listening", "assemblyai");
    } else if (m.type === "Turn") {
      const text = (m.transcript || "").trim();
      // A formatted end-of-turn is the clean final; everything else is interim.
      if (m.end_of_turn && m.turn_is_formatted) {
        h.onInterim("");
        if (text) h.onFinal(text);
      } else {
        h.onInterim(text);
      }
    }
  };

  ws.onerror = () => {
    if (!stopped) {
      h.onStatus?.("error", "assemblyai");
      h.onError?.("assemblyai");
    }
  };
  ws.onclose = () => {
    if (!stopped) h.onStatus?.("error", "assemblyai");
  };

  return {
    stop: () => {
      stopped = true;
      clearTimeout(watchdog);
      try {
        if (proc) proc.onaudioprocess = null;
        proc?.disconnect();
        src?.disconnect();
        mute?.disconnect();
      } catch {
        /* noop */
      }
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "Terminate" }));
        }
        ws.close();
      } catch {
        /* noop */
      }
      h.onStatus?.("off");
    },
  };
}

/** Box-average downsample to 16 kHz mono PCM16 (anti-aliased decimation). */
function to16kPcm(buf: Float32Array, sr: number): ArrayBuffer {
  const ratio = sr / TARGET_SR;
  if (ratio <= 1) {
    const out = new Int16Array(buf.length);
    for (let i = 0; i < buf.length; i++) out[i] = clampPcm(buf[i]);
    return out.buffer;
  }
  const outLen = Math.max(1, Math.floor(buf.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(buf.length, Math.floor((i + 1) * ratio));
    let s = 0;
    let n = 0;
    for (let j = start; j < end; j++) {
      s += buf[j];
      n++;
    }
    out[i] = clampPcm(n ? s / n : 0);
  }
  return out.buffer;
}

function clampPcm(v: number): number {
  if (v > 1) v = 1;
  else if (v < -1) v = -1;
  return v < 0 ? v * 0x8000 : v * 0x7fff;
}
