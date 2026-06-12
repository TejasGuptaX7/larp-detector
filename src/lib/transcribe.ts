// Transcription with graceful degradation, fastest/most-accurate first:
//   1. AssemblyAI realtime (when the server has a key) — sub-second, accurate.
//   2. In-browser Moonshine (asr.ts) — no key, works offline/cross-browser.
//   3. Web Speech API — last resort on browsers that support it.

import { startAssemblyAI } from "./assemblyai";
import { startAsr } from "./asr";
import { startStt, sttSupported, type SttHandlers, type SttHandle } from "./stt";

const BASE = import.meta.env.VITE_JUDGE_URL ?? "http://localhost:8787";
// Simplest path: drop the AssemblyAI key in the frontend env and the browser
// connects directly (the key doubles as the WS token). Convenient for a personal
// demo — the key ends up in the bundle. For real hosting, leave this unset and
// mint a short-lived token server-side (/api/aai-token) instead.
const DIRECT_KEY = import.meta.env.VITE_ASSEMBLYAI_API_KEY as string | undefined;

async function getAaiToken(): Promise<string | null> {
  if (DIRECT_KEY && DIRECT_KEY.trim()) {
    const key = DIRECT_KEY.trim();
    // Prefer minting a short-lived token from the browser (if AssemblyAI's CORS
    // allows it); otherwise the key itself works as the WS token.
    try {
      const r = await fetch(
        "https://streaming.assemblyai.com/v3/token?expires_in_seconds=300",
        { headers: { Authorization: key } },
      );
      if (r.ok) {
        const d = (await r.json()) as { token?: string };
        if (typeof d.token === "string") return d.token;
      }
    } catch {
      /* CORS/network — fall through to using the key directly */
    }
    return key;
  }
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
    const token = await getAaiToken();
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
