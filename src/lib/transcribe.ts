// Transcription with graceful degradation:
//   1. In-browser Moonshine (asr.ts) — works in every browser, no key, shares
//      the single mic. This is the default and fixes the cross-browser failures.
//   2. If the model can't load (e.g. offline), fall back to the Web Speech API
//      on browsers that actually support it.

import { startAsr } from "./asr";
import { startStt, sttSupported, type SttHandlers, type SttHandle } from "./stt";

export function startTranscription(h: SttHandlers): SttHandle {
  let current: SttHandle | null = null;
  let fellBack = false;

  const wrapped: SttHandlers = {
    onInterim: h.onInterim,
    onFinal: h.onFinal,
    onError: h.onError,
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
  };

  current = startAsr(wrapped);
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
