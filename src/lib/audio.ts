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

/** Open one microphone (optionally a specific device) and expose an analyser. */
export async function openMic(deviceId?: string): Promise<MicHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
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
