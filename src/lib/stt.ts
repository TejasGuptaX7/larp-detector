// Live speech-to-text via the Web Speech API (Chrome). Recognition sessions
// die constantly (silence timeouts, network hiccups, tab focus), so we treat
// every session as disposable: when one ends we spawn a FRESH instance after
// a short backoff. Reusing the old instance is what silently kills capture.

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: { length: number } & Record<number, SpeechRecognitionResultLike>;
};
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function sttSupported(): boolean {
  // The constructor existing is NOT enough — Web Speech also needs a secure
  // context (https/localhost). Over plain-http LAN it throws on start().
  return getCtor() !== null && (typeof isSecureContext === "undefined" || isSecureContext);
}

export type SttStatus = "listening" | "restarting" | "error" | "off" | "loading";

// Errors that will never self-heal — stop retrying and surface them.
const FATAL = new Set(["not-allowed", "service-not-allowed", "audio-capture"]);

export type SttHandlers = {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onStatus?: (status: SttStatus, detail?: string) => void;
  onError?: (err: string) => void;
};

export type SttHandle = { stop: () => void };

export function startStt(h: SttHandlers): SttHandle {
  const Ctor = getCtor();
  if (!Ctor) {
    h.onError?.("unsupported");
    h.onStatus?.("error", "unsupported");
    return { stop: () => {} };
  }

  let stopped = false;
  let fatal = false;
  let rec: SpeechRecognitionLike | null = null;
  let restartTimer: number | null = null;
  let backoff = 300;
  let networkFails = 0;

  function scheduleRestart() {
    if (stopped || fatal || restartTimer !== null) return;
    h.onStatus?.("restarting");
    restartTimer = window.setTimeout(() => {
      restartTimer = null;
      spawn();
    }, backoff);
    backoff = Math.min(backoff * 2, 4000);
  }

  function spawn() {
    if (stopped) return;
    const r = new Ctor!();
    rec = r;
    r.lang = "en-US";
    r.continuous = true;
    r.interimResults = true;

    r.onresult = (e) => {
      backoff = 300; // healthy session — reset backoff
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const txt = res[0].transcript;
        if (res.isFinal) h.onFinal(txt.trim());
        else interim += txt;
      }
      if (interim) h.onInterim(interim.trim());
    };

    r.onerror = (e) => {
      // no-speech + aborted are routine. Permission/capture errors are fatal —
      // retrying never helps, so stop and surface them. Persistent 'network'
      // means this browser has no working speech backend (Brave/Arc/no-key,
      // offline); after a couple, give up instead of an invisible retry loop.
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (FATAL.has(e.error) || (e.error === "network" && ++networkFails >= 2)) {
        fatal = true;
        h.onStatus?.("error", e.error);
        h.onError?.(e.error);
        return;
      }
      h.onStatus?.("error", e.error);
      h.onError?.(e.error);
    };

    r.onend = () => {
      if (rec === r) rec = null;
      scheduleRestart();
    };

    try {
      r.start();
      h.onStatus?.("listening", "web speech");
    } catch {
      scheduleRestart();
    }
  }

  spawn();

  return {
    stop: () => {
      stopped = true;
      if (restartTimer !== null) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      try {
        rec?.abort();
      } catch {
        /* ignore */
      }
      rec = null;
      h.onStatus?.("off");
    },
  };
}
