// Lightweight in-browser voice fingerprinting for speaker recognition.
//
// We never "mix" the two speakers: instead each person is enrolled once
// (they say hello + a line) which yields a voice profile = an average MFCC
// vector plus a pitch range. At runtime every short audio frame is matched
// to the nearest profile, so each spoken phrase is attributed to A or B by
// the *sound of the voice*, not by which device was louder.

import { audioCtx } from "./audio";

const N_MEL = 26; // mel filterbank bands
const N_MFCC = 13; // DCT coefficients (we keep 1..12, drop the energy term)
const F_MIN = 80; // Hz
const F_MAX = 8000; // Hz

/**
 * Gate: ignore frames quieter than this. Browsers apply noiseSuppression +
 * autoGainControl which keeps speech levels low — 0.018 was rejecting most
 * real speech frames ("70% voiced" enrollments, dead matching). 0.007 keeps
 * silence out while accepting normal conversational volume.
 */
export const VOICED_GATE = 0.007;
const VOICE_RMS = VOICED_GATE;

export type VoiceProfile = {
  name: string;
  mfcc: number[]; // L2-normalized mean MFCC (length 12)
  pitchMean: number; // Hz
  pitchStd: number; // Hz
};

export type VoiceFrame = {
  mfcc: number[]; // length 12 (coeffs 1..12)
  pitch: number; // Hz, 0 when unvoiced
  rms: number; // 0..1 loudness
};

// ---------- mel / mfcc math ----------

function hzToMel(f: number): number {
  return 2595 * Math.log10(1 + f / 700);
}
function melToHz(m: number): number {
  return 700 * (10 ** (m / 2595) - 1);
}

function melFilterbank(binCount: number, sampleRate: number): number[][] {
  const fftSize = binCount * 2;
  const melMin = hzToMel(F_MIN);
  const melMax = hzToMel(F_MAX);
  const pts: number[] = [];
  for (let i = 0; i < N_MEL + 2; i++) {
    pts.push(melToHz(melMin + ((melMax - melMin) * i) / (N_MEL + 1)));
  }
  const bins = pts.map((hz) => Math.floor(((fftSize + 1) * hz) / sampleRate));
  const fb: number[][] = [];
  for (let m = 1; m <= N_MEL; m++) {
    const f = new Array<number>(binCount).fill(0);
    const left = bins[m - 1];
    const center = bins[m];
    const right = bins[m + 1];
    for (let k = left; k < center; k++) {
      if (k >= 0 && k < binCount) f[k] = (k - left) / Math.max(1, center - left);
    }
    for (let k = center; k < right; k++) {
      if (k >= 0 && k < binCount) f[k] = (right - k) / Math.max(1, right - center);
    }
    fb.push(f);
  }
  return fb;
}

function dct(logMel: number[]): number[] {
  const N = logMel.length;
  const out: number[] = [];
  for (let k = 0; k < N_MFCC; k++) {
    let s = 0;
    for (let n = 0; n < N; n++) {
      s += logMel[n] * Math.cos((Math.PI * k * (2 * n + 1)) / (2 * N));
    }
    out.push(s);
  }
  return out;
}

function detectPitch(buf: Float32Array<ArrayBuffer>, sampleRate: number): number {
  let energy = 0;
  for (let i = 0; i < buf.length; i++) energy += buf[i] * buf[i];
  if (Math.sqrt(energy / buf.length) < 0.01) return 0;

  const minLag = Math.floor(sampleRate / 350);
  const maxLag = Math.floor(sampleRate / 70);
  let bestLag = -1;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < buf.length - lag; i++) s += buf[i] * buf[i + lag];
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  return bestLag > 0 ? sampleRate / bestLag : 0;
}

// ---------- engine ----------

export class VoiceEngine {
  private analyser: AnalyserNode;
  private freq: Float32Array<ArrayBuffer>;
  private time: Float32Array<ArrayBuffer>;
  private fb: number[][];
  private sr: number;
  private src: MediaStreamAudioSourceNode;

  constructor(stream: MediaStream) {
    const ac = audioCtx();
    this.src = ac.createMediaStreamSource(stream);
    const an = ac.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0;
    this.src.connect(an);
    this.analyser = an;
    this.sr = ac.sampleRate;
    this.freq = new Float32Array(an.frequencyBinCount);
    this.time = new Float32Array(an.fftSize);
    this.fb = melFilterbank(an.frequencyBinCount, this.sr);
  }

  /** Compute one feature frame from the current mic buffer. */
  frame(): VoiceFrame {
    this.analyser.getFloatFrequencyData(this.freq);
    this.analyser.getFloatTimeDomainData(this.time);

    const power = new Array<number>(this.freq.length);
    for (let i = 0; i < this.freq.length; i++) {
      const mag = 10 ** (this.freq[i] / 20); // dB -> magnitude
      power[i] = mag * mag;
    }
    const logMel = this.fb.map((f) => {
      let e = 0;
      for (let k = 0; k < f.length; k++) e += f[k] * power[k];
      return Math.log(e + 1e-8);
    });
    const mfcc = dct(logMel).slice(1, N_MFCC);

    let r = 0;
    for (let i = 0; i < this.time.length; i++) r += this.time[i] * this.time[i];
    r = Math.sqrt(r / this.time.length);

    return { mfcc, pitch: detectPitch(this.time, this.sr), rms: r };
  }

  dispose(): void {
    try {
      this.src.disconnect();
    } catch {
      /* noop */
    }
  }
}

// ---------- profiles + matching ----------

function l2norm(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}
function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
function mean(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}
function std(v: number[], m: number): number {
  if (v.length < 2) return 0;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
}

function meanMfcc(frames: VoiceFrame[]): number[] {
  const dim = frames[0].mfcc.length;
  const acc = new Array<number>(dim).fill(0);
  for (const f of frames) for (let i = 0; i < dim; i++) acc[i] += f.mfcc[i];
  for (let i = 0; i < dim; i++) acc[i] /= frames.length;
  return acc;
}

/** Build a voice profile from enrollment frames. */
export function buildProfile(name: string, frames: VoiceFrame[]): VoiceProfile {
  const voiced = frames.filter((f) => f.rms > VOICE_RMS);
  const use = voiced.length > 5 ? voiced : frames;
  const norm = l2norm(meanMfcc(use));
  const pitches = use.map((f) => f.pitch).filter((p) => p > 0);
  const pm = mean(pitches);
  const ps = Math.max(std(pitches, pm), 8);
  return { name, mfcc: norm, pitchMean: pm, pitchStd: ps };
}

/** Was there enough voiced signal in this clip to trust the profile? */
export function enrollQuality(frames: VoiceFrame[]): number {
  const voiced = frames.filter((f) => f.rms > VOICE_RMS).length;
  return frames.length ? voiced / frames.length : 0;
}

export type MatchResult = { idx: number; conf: number };

/**
 * Match a window of frames to the nearest profile.
 * Returns null when the window is mostly silence.
 */
export function matchWindow(
  frames: VoiceFrame[],
  profiles: VoiceProfile[],
): MatchResult | null {
  const voiced = frames.filter((f) => f.rms > VOICE_RMS);
  if (voiced.length < 2 || profiles.length === 0) return null;

  const norm = l2norm(meanMfcc(voiced));
  const pitches = voiced.map((f) => f.pitch).filter((p) => p > 0);
  const pm = mean(pitches);

  const scores = profiles.map((p) => {
    const cos = dot(norm, p.mfcc); // -1..1
    let pitchScore = 0.5;
    if (pm > 0 && p.pitchMean > 0) {
      const z = Math.abs(pm - p.pitchMean) / p.pitchStd;
      pitchScore = Math.exp(-0.5 * z * z);
    }
    return 0.6 * ((cos + 1) / 2) + 0.4 * pitchScore;
  });

  let bi = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[bi]) bi = i;
  const sorted = [...scores].sort((a, b) => b - a);
  const conf = sorted.length > 1 ? sorted[0] - sorted[1] : sorted[0];
  return { idx: bi, conf };
}
