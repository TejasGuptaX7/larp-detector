// Transcription with graceful degradation, fastest/most-accurate first:
//   1. AssemblyAI realtime (when the server has a key) — sub-second, accurate.
//   2. In-browser Moonshine (asr.ts) — no key, works offline/cross-browser.
//   3. Web Speech API — last resort on browsers that support it.

import { startAssemblyAI } from "./assemblyai";
import { startAsr } from "./asr";
import { startStt, sttSupported, type SttHandlers, type SttHandle } from "./stt";

const BASE = import.meta.env.VITE_JUDGE_URL ?? "http://localhost:8787";

async function fetchAaiToken(): Promise<string | null> {
  try {
    const r = await fetch(`${BASE}/api/aai-token`);
    if (!r.ok) return null;
    const d = (await r.json()) as { token?: string };
    return typeof d.token === "string" ? d.token : null;
  } catch {
    return null;
  }
}

/** Moonshine first, Web Speech if the model can't load. */
function startInBrowser(h: SttHandlers): SttHandle {
  let current: SttHandle | null = null;
  let fellBack = false;
  current = startAsr({
    ...h,
    onStatus: (s, d) => {
      if (s === "error" && d === "asr-unavailable" && !fellBack) {
        fellBack = true;
        try {
          current?.stop();
        } catch {
          /* noop */
        }
        if (sttSupported()) {
          h.onStatus?.("loading", "fallback");
          current = startStt(h);
        } else {
          h.onStatus?.("error", "transcription unavailable");
        }
        return;
      }
      h.onStatus?.(s, d);
    },
  });
  return {
    stop: () => {
      try {
        current?.stop();
      } catch {
        /* noop */
      }
    },
  };
}

export function startTranscription(h: SttHandlers): SttHandle {
  let current: SttHandle | null = null;
  let stopped = false;

  (async () => {
    const token = await fetchAaiToken();
    if (stopped) return;

    if (token) {
      let listened = false;
      current = startAssemblyAI(
        {
          ...h,
          onStatus: (s, d) => {
            if (s === "listening") listened = true;
            // If the realtime socket fails before we ever heard anything, the
            // key/connection is bad — fall back to in-browser instead of dying.
            if (s === "error" && !listened && !stopped) {
              try {
                current?.stop();
              } catch {
                /* noop */
              }
              current = startInBrowser(h);
              return;
            }
            h.onStatus?.(s, d);
          },
        },
        token,
      );
    } else {
      current = startInBrowser(h);
    }
  })();

  return {
    stop: () => {
      stopped = true;
      try {
        current?.stop();
      } catch {
        /* noop */
      }
    },
  };
}
