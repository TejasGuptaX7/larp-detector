// In-browser speech-to-text worker. Loads Moonshine (an ONNX ASR model built
// for low-latency live voice) via transformers.js and transcribes 16 kHz mono
// Float32 utterances handed to it by asr.ts. Runs off the UI thread so model
// inference never janks the dashboard.
//
// This replaces the Web Speech API as the primary transcriber: it needs no API
// key, no Google backend, and works the same in Chrome, Brave, Arc, Firefox and
// Safari — the cross-browser failures that left production with no transcript.

import { pipeline, env } from "@huggingface/transformers";

// Always fetch the model from the Hugging Face hub (no bundled local model).
env.allowLocalModels = false;

const MODEL = "onnx-community/moonshine-base-ONNX";

// loose worker typing to avoid DOM-vs-webworker lib friction in tsc
const worker = self as unknown as {
  postMessage: (m: unknown, t?: Transferable[]) => void;
  onmessage: ((e: { data: AsrIn }) => void) | null;
};

type AsrIn =
  | { type: "load" }
  | { type: "transcribe"; id: number; audio: Float32Array };

type Transcriber = (
  audio: Float32Array,
  opts?: Record<string, unknown>,
) => Promise<{ text?: string }>;

let transcriber: Transcriber | null = null;
let loading: Promise<void> | null = null;

async function loadWith(device: "webgpu" | "wasm"): Promise<void> {
  const t = (await pipeline("automatic-speech-recognition", MODEL, {
    device,
    progress_callback: (p: unknown) =>
      worker.postMessage({ type: "progress", data: p }),
  })) as unknown as Transcriber;
  transcriber = t;
}

async function load(): Promise<void> {
  // Prefer WebGPU when present, but fall back to WASM (which is often just as
  // fast for a model this size and is supported essentially everywhere).
  const hasGpu = typeof (navigator as { gpu?: unknown }).gpu !== "undefined";
  try {
    await loadWith(hasGpu ? "webgpu" : "wasm");
    worker.postMessage({ type: "ready", device: hasGpu ? "webgpu" : "wasm" });
  } catch {
    try {
      await loadWith("wasm");
      worker.postMessage({ type: "ready", device: "wasm" });
    } catch (err) {
      worker.postMessage({ type: "error", error: String(err) });
    }
  }
}

worker.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "load") {
    if (!loading) loading = load();
    await loading;
    return;
  }
  if (msg.type === "transcribe") {
    if (!transcriber) {
      worker.postMessage({ type: "result", id: msg.id, text: "" });
      return;
    }
    try {
      const out = await transcriber(msg.audio);
      const text = (out?.text ?? "").trim();
      worker.postMessage({ type: "result", id: msg.id, text });
    } catch (err) {
      worker.postMessage({ type: "result", id: msg.id, text: "", error: String(err) });
    }
  }
};
