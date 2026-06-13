// Realtime transcription via AssemblyAI Universal-Streaming. Fast (sub-second
// finals) and accurate — replaces the in-browser model when a key is configured.
//
// The browser opens the WebSocket DIRECTLY with a short-lived token minted by our
// server (/api/aai-token) or derived from VITE_ASSEMBLYAI_API_KEY; the long-lived
// key never needs to leave the server. Audio is captured off the ONE shared mic
// stream (no second getUserMedia), downsampled to 16 kHz PCM16, and streamed
// continuously — AssemblyAI does the endpointing, so finals arrive within a few
// hundred ms of a pause. Speaker attribution still comes from our own voice
// gateway; this only supplies the words.
//
// Hard-won correctness notes:
//  - FINALS ARE GUARANTEED. With format_turns=true the server sends the turn
//    with end_of_turn=true (unformatted) first and a formatted upgrade after.
//    If we waited only for the formatted one (old behavior) and it never came,
//    captions showed but no text ever reached the scorer — the "live text but
//    score stuck at 0" bug. Now an end-of-turn is finalized after a short grace
//    window even if the formatted upgrade never arrives, deduped by turn_order.
//  - SESSIONS RECONNECT. Streaming sockets drop on network blips; we re-mint a
//    token and reconnect with backoff instead of going silent mid-conversation.

import { audioCtx } from "./audio";
import { getStream } from "./session";
import type { SttHandlers, SttHandle } from "./stt";

const TARGET_SR = 16000;
// Overridable so tests can point the client at a local protocol mock.
const WS_BASE =
  (import.meta.env.VITE_AAI_WS_URL as string | undefined) ??
  "wss://streaming.assemblyai.com/v3/ws";

const CONNECT_TIMEOUT_MS = 8000;
const FORMAT_GRACE_MS = 1100; // wait this long for the formatted upgrade
const MAX_RECONNECTS = 5;

type TurnMsg = {
  type?: "Begin" | "Turn" | "Termination";
  turn_order?: number;
  transcript?: string;
  end_of_turn?: boolean;
  turn_is_formatted?: boolean;
};

export function startAssemblyAI(
  h: SttHandlers,
  mintToken: () => Promise<string | null>,
): SttHandle {
  const stream = getStream();
  if (!stream) {
    h.onStatus?.("error", "no-mic");
    return { stop: () => {} };
  }
  const ac = audioCtx();
  let stopped = false;
  let ws: WebSocket | null = null;
  let watchdog: number | null = null;
  let reconnects = 0;
  let everConnected = false;

  // ---- capture once; frames flow into whichever socket is currently open ----
  const src = ac.createMediaStreamSource(stream);
  const proc = ac.createScriptProcessor(4096, 1, 1);
  const mute = ac.createGain();
  mute.gain.value = 0; // sink so the node runs without echoing the mic
  src.connect(proc);
  proc.connect(mute);
  mute.connect(ac.destination);
  const sr = ac.sampleRate;
  proc.onaudioprocess = (ev) => {
    if (stopped || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(to16kPcm(ev.inputBuffer.getChannelData(0), sr));
  };

  // ---- guaranteed-final turn handling ----
  const finalized = new Set<number>();
  let pendingOrder: number | null = null;
  let pendingTimer: number | null = null;

  function finalize(order: number, text: string) {
    if (finalized.has(order)) return;
    finalized.add(order);
    if (finalized.size > 500) {
      // keep the set bounded on very long sessions
      const first = finalized.values().next().value;
      if (first !== undefined) finalized.delete(first);
    }
    clearPending();
    h.onInterim("");
    if (text) h.onFinal(text);
  }

  function clearPending() {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    pendingOrder = null;
  }

  function handleTurn(m: TurnMsg) {
    const text = (m.transcript || "").trim();
    const order = m.turn_order ?? -1;
    if (!m.end_of_turn) {
      // live partial — this is the word-by-word caption
      if (!finalized.has(order)) h.onInterim(text);
      return;
    }
    if (m.turn_is_formatted) {
      finalize(order, text);
      return;
    }
    // Unformatted end-of-turn: give the formatted upgrade a short grace window,
    // then finalize this text anyway so the scorer ALWAYS gets the line.
    if (finalized.has(order)) return;
    clearPending();
    pendingOrder = order;
    pendingTimer = window.setTimeout(() => {
      pendingTimer = null;
      if (pendingOrder !== null) finalize(pendingOrder, text);
    }, FORMAT_GRACE_MS);
  }

  // ---- connection lifecycle with reconnect ----
  function fail(detail: string) {
    if (stopped) return;
    stopped = true; // terminal for this engine; caller decides the fallback
    teardownAudio();
    h.onStatus?.("error", detail);
    h.onError?.(detail);
  }

  async function connect() {
    if (stopped) return;
    const token = await mintToken();
    if (stopped) return;
    if (!token) {
      fail("assemblyai-token");
      return;
    }

    const url =
      `${WS_BASE}?sample_rate=${TARGET_SR}&encoding=pcm_s16le&format_turns=true` +
      `&token=${encodeURIComponent(token)}`;
    let sock: WebSocket;
    try {
      sock = new WebSocket(url);
    } catch {
      fail("assemblyai");
      return;
    }
    sock.binaryType = "arraybuffer";
    ws = sock;
    let begun = false;

    if (watchdog !== null) clearTimeout(watchdog);
    watchdog = window.setTimeout(() => {
      if (!begun && !stopped) {
        try {
          sock.close();
        } catch {
          /* noop */
        }
        // onclose handles retry/fail bookkeeping
      }
    }, CONNECT_TIMEOUT_MS);

    sock.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      let m: TurnMsg;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.type === "Begin") {
        begun = true;
        everConnected = true;
        reconnects = 0;
        if (watchdog !== null) {
          clearTimeout(watchdog);
          watchdog = null;
        }
        h.onStatus?.("listening", "assemblyai");
      } else if (m.type === "Turn") {
        handleTurn(m);
      }
    };

    sock.onclose = () => {
      if (stopped || ws !== sock) return;
      ws = null;
      if (!everConnected && reconnects === 0) {
        // never got a session at all — bad key/region/CORS; bail fast so the
        // caller can fall back to the on-device engine
        fail("assemblyai");
        return;
      }
      if (reconnects >= MAX_RECONNECTS) {
        fail("assemblyai-lost");
        return;
      }
      reconnects++;
      h.onStatus?.("restarting", "assemblyai");
      const backoff = Math.min(5000, 700 * 2 ** (reconnects - 1));
      window.setTimeout(() => void connect(), backoff);
    };
    // errors always surface as a close right after; onclose owns recovery
    sock.onerror = () => {};
  }

  function teardownAudio() {
    try {
      proc.onaudioprocess = null;
      proc.disconnect();
      src.disconnect();
      mute.disconnect();
    } catch {
      /* noop */
    }
    if (watchdog !== null) {
      clearTimeout(watchdog);
      watchdog = null;
    }
    clearPending();
  }

  h.onStatus?.("loading");
  void connect();

  return {
    stop: () => {
      if (stopped) {
        teardownAudio();
        return;
      }
      stopped = true;
      teardownAudio();
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "Terminate" }));
        }
        ws?.close();
      } catch {
        /* noop */
      }
      ws = null;
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
