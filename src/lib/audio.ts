export type MicHandle = {
  analyser: AnalyserNode;
  stream: MediaStream;
  stop: () => void;
};

let sharedCtx: AudioContext | null = null;

function ctx(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  if (sharedCtx.state === "suspended") void sharedCtx.resume();
  return sharedCtx;
}

/** Shared AudioContext, so feature extractors can tap the same graph. */
export function audioCtx(): AudioContext {
  return ctx();
}

export async function listInputs(): Promise<MediaDeviceInfo[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === "audioinput");
}

/**
 * Open one microphone (optionally a specific device) and expose an analyser.
 *
 * CRITICAL for speaker recognition: we request RAW audio. The browser's
 * echoCancellation / noiseSuppression / autoGainControl are great for calls but
 * catastrophic for telling two voices apart — AGC normalizes loudness (erasing
 * level cues), and noiseSuppression reshapes the very spectral envelope that
 * MFCC fingerprints rely on. With them on, both speakers collapse toward the
 * same "cleaned" timbre. We turn them all off so each voice keeps its identity.
 */
export async function openMic(deviceId?: string): Promise<MicHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
    video: false,
  });

  const ac = ctx();
  const src = ac.createMediaStreamSource(stream);
  const analyser = ac.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.78;
  src.connect(analyser);

  return {
    analyser,
    stream,
    stop: () => {
      try {
        src.disconnect();
      } catch {
        /* noop */
      }
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

/** Current RMS loudness 0..1 from an analyser, for activity / VU. */
export function rms(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}
