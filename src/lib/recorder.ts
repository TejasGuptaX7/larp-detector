// Records the live conversation to a single audio file (for playback/download
// after the session). Speaker attribution lives in the labeled transcript, not
// in the audio — the audio is the raw record of what was said.

export type Recording = { url: string; mime: string; ms: number };

export class ConvoRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;

  constructor(private stream: MediaStream) {}

  start(): void {
    const mime = pickMime();
    this.chunks = [];
    try {
      this.rec = mime ? new MediaRecorder(this.stream, { mimeType: mime }) : new MediaRecorder(this.stream);
    } catch {
      this.rec = new MediaRecorder(this.stream);
    }
    this.rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.startedAt = Date.now();
    this.rec.start(1000);
  }

  stop(): Promise<Recording | null> {
    return new Promise((resolve) => {
      const r = this.rec;
      if (!r || r.state === "inactive") {
        resolve(null);
        return;
      }
      r.onstop = () => {
        const mime = r.mimeType || "audio/webm";
        const blob = new Blob(this.chunks, { type: mime });
        resolve({
          url: URL.createObjectURL(blob),
          mime,
          ms: Date.now() - this.startedAt,
        });
      };
      r.stop();
    });
  }
}

function pickMime(): string | "" {
  const opts = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const o of opts) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(o)) return o;
  }
  return "";
}
