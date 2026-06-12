// In-browser speaker recognition for a two-person conversation.
//
// One microphone, two enrolled voices. We never "mix" the speakers: each person
// is enrolled once (they read a short passage) which yields a *voice profile* —
// a statistical fingerprint of their timbre and pitch. At runtime every short
// audio window is matched to the nearest profile, so each spoken phrase is
// attributed to A or B by the *sound of the voice*, not by who was louder.
//
// The classifier is a per-speaker diagonal-Gaussian (naïve-Bayes) model over a
// compact acoustic feature vector (MFCC + spectral shape) plus a dedicated pitch
// term. Storing each profile's per-dimension mean AND variance lets us measure
// how well a window fits a voice in that voice's own units — far more reliable
// than a single cosine distance.

import { audioCtx } from "./audio";

const N_MEL = 26; // mel filterbank bands
const N_MFCC = 13; // DCT coefficients (we keep 1..12, drop the c0 energy term)
const N_MFCC_KEEP = N_MFCC - 1; // 12 timbre coefficients
const F_MIN = 80; // Hz
const F_MAX = 8000; // Hz

// Pitch search range (human voice). 70–350 Hz covers low male to high female.
const PITCH_MIN_HZ = 70;
const PITCH_MAX_HZ = 350;
// Below this normalized-autocorrelation clarity the "pitch" is just noise.
const PITCH_CLARITY = 0.55;

/**
 * Loudness gate: ignore frames quieter than this. With autoGainControl now OFF
 * (see audio.ts) real conversational speech sits well above this, while room
 * tone stays below it.
 */
export const VOICED_GATE = 0.012;
const VOICE_RMS = VOICED_GATE;

// Timbre feature layout: 12 MFCC + centroid + rolloff + flatness + zero-cross.
// Loudness/energy is deliberately excluded from identity — it's a VAD cue only.
const TIMBRE_DIM = N_MFCC_KEEP + 4;

export type VoiceProfile = {
  name: string;
  // Diagonal-Gaussian over the timbre vector (length TIMBRE_DIM).
  mean: number[];
  std: number[];
  // Pitch statistics in Hz (0 fields mean "no voiced pitch captured").
  pitchMean: number;
  pitchStd: number;
  pitchMin: number;
  pitchMax: number;
  // Mean spectral centroid in Hz — drives the "bright/warm" descriptor.
  centroidHz: number;
  // How much real speech the profile was built from.
  voicedFrames: number;
  voicedSec: number;
};

export type VoiceFrame = {
  mfcc: number[]; // length 12 (coeffs 1..12)
  centroid: number; // normalized 0..1 (fraction of Nyquist)
  rolloff: number; // normalized 0..1 (85% spectral energy roll-off)
  flatness: number; // 0..1 (tonal -> 0, noisy -> 1)
  zcr: number; // 0..1 zero-crossing rate
  centroidHz: number; // spectral centroid in Hz
  pitch: number; // Hz, 0 when unvoiced
  clarity: number; // 0..1 pitch confidence
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

/**
 * Pitch via the McLeod-style normalized square difference function (NSDF).
 * Unlike raw autocorrelation (which favours the loudest lag and octave-jumps),
 * NSDF is amplitude-independent and yields a clarity score we can threshold on.
 * Returns [hz, clarity]; hz is 0 when no confident pitch is found.
 */
function detectPitch(
  buf: Float32Array<ArrayBuffer>,
  sampleRate: number,
): [number, number] {
  const n = buf.length;
  let energy = 0;
  for (let i = 0; i < n; i++) energy += buf[i] * buf[i];
  if (Math.sqrt(energy / n) < 0.008) return [0, 0];

  const minLag = Math.floor(sampleRate / PITCH_MAX_HZ);
  const maxLag = Math.min(n - 1, Math.floor(sampleRate / PITCH_MIN_HZ));

  // NSDF: 2*acf(lag) / (energy of the two overlapping windows).
  const nsdf = new Array<number>(maxLag + 1).fill(0);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acf = 0;
    let div = 0;
    for (let i = 0; i < n - lag; i++) {
      acf += buf[i] * buf[i + lag];
      div += buf[i] * buf[i] + buf[i + lag] * buf[i + lag];
    }
    nsdf[lag] = div > 0 ? (2 * acf) / div : 0;
  }

  // Pick the first strong local maximum (the true period, not an octave above).
  let bestLag = -1;
  let bestVal = 0;
  let i = minLag + 1;
  // walk to the first positive-going zero crossing so we skip the lag-0 hump
  while (i < maxLag && nsdf[i] <= 0) i++;
  for (; i < maxLag; i++) {
    if (nsdf[i] > nsdf[i - 1] && nsdf[i] >= nsdf[i + 1]) {
      if (nsdf[i] > bestVal) {
        bestVal = nsdf[i];
        bestLag = i;
      }
      // first clear peak above threshold wins — guards against octave doubling
      if (bestVal > 0.8) break;
    }
  }
  if (bestLag < 0 || bestVal < PITCH_CLARITY) return [0, 0];

  // Parabolic interpolation around the peak for sub-sample accuracy.
  const a = nsdf[bestLag - 1];
  const b = nsdf[bestLag];
  const c = nsdf[bestLag + 1];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  const refined = bestLag + Math.max(-1, Math.min(1, shift));
  return [sampleRate / refined, bestVal];
}

// ---------- engine ----------

export class VoiceEngine {
  private analyser: AnalyserNode;
  private freq: Float32Array<ArrayBuffer>;
  private time: Float32Array<ArrayBuffer>;
  private fb: number[][];
  private sr: number;
  private src: MediaStreamAudioSourceNode;
  private binHz: number;

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
    this.binHz = this.sr / an.fftSize;
  }

  /** Compute one feature frame from the current mic buffer. */
  frame(): VoiceFrame {
    this.analyser.getFloatFrequencyData(this.freq);
    this.analyser.getFloatTimeDomainData(this.time);

    const nBins = this.freq.length;
    const power = new Array<number>(nBins);
    let totalPower = 0;
    let centroidAcc = 0;
    let logSum = 0; // for spectral flatness (geometric mean via log)
    for (let i = 0; i < nBins; i++) {
      const mag = 10 ** (this.freq[i] / 20); // dB -> magnitude
      const p = mag * mag;
      power[i] = p;
      totalPower += p;
      centroidAcc += p * (i * this.binHz);
      logSum += Math.log(p + 1e-12);
    }

    const logMel = this.fb.map((f) => {
      let e = 0;
      for (let k = 0; k < f.length; k++) e += f[k] * power[k];
      return Math.log(e + 1e-8);
    });
    const mfcc = dct(logMel).slice(1, N_MFCC);

    const centroidHz = totalPower > 0 ? centroidAcc / totalPower : 0;
    const nyquist = this.sr / 2;
    const centroid = Math.min(1, centroidHz / nyquist);

    // Spectral roll-off: frequency below which 85% of energy lies.
    let cum = 0;
    let rollBin = 0;
    const target = totalPower * 0.85;
    for (let i = 0; i < nBins; i++) {
      cum += power[i];
      if (cum >= target) {
        rollBin = i;
        break;
      }
    }
    const rolloff = Math.min(1, (rollBin * this.binHz) / nyquist);

    // Spectral flatness: geometric mean / arithmetic mean of the power spectrum.
    const geo = Math.exp(logSum / nBins);
    const arith = totalPower / nBins;
    const flatness = arith > 0 ? Math.min(1, geo / arith) : 0;

    // Time-domain stats.
    let r = 0;
    let zc = 0;
    for (let i = 0; i < this.time.length; i++) {
      r += this.time[i] * this.time[i];
      if (i > 0 && (this.time[i] >= 0) !== (this.time[i - 1] >= 0)) zc++;
    }
    r = Math.sqrt(r / this.time.length);
    const zcr = zc / this.time.length;

    const [pitch, clarity] = detectPitch(this.time, this.sr);

    return {
      mfcc,
      centroid,
      rolloff,
      flatness,
      zcr,
      centroidHz,
      pitch,
      clarity,
      rms: r,
    };
  }

  dispose(): void {
    try {
      this.src.disconnect();
    } catch {
      /* noop */
    }
  }
}

// ---------- feature vectors + stats ----------

/** Flatten a frame into the timbre vector the classifier scores on. */
function timbreVec(f: VoiceFrame): number[] {
  return [...f.mfcc, f.centroid, f.rolloff, f.flatness, f.zcr];
}

function mean(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}
function std(v: number[], m: number): number {
  if (v.length < 2) return 0;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
}
function median(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------- profiles ----------

/** Build a voice profile from enrollment frames. */
export function buildProfile(name: string, frames: VoiceFrame[]): VoiceProfile {
  const voiced = frames.filter((f) => f.rms > VOICE_RMS);
  const use = voiced.length > 8 ? voiced : frames;

  // Per-dimension mean & std of the timbre vector across voiced frames.
  const vecs = use.map(timbreVec);
  const dim = TIMBRE_DIM;
  const mn = new Array<number>(dim).fill(0);
  for (const v of vecs) for (let i = 0; i < dim; i++) mn[i] += v[i];
  for (let i = 0; i < dim; i++) mn[i] /= Math.max(1, vecs.length);
  const sd = new Array<number>(dim).fill(0);
  for (const v of vecs) for (let i = 0; i < dim; i++) sd[i] += (v[i] - mn[i]) ** 2;
  for (let i = 0; i < dim; i++) {
    sd[i] = Math.sqrt(sd[i] / Math.max(1, vecs.length));
    // Floor each std so a near-constant dimension can't dominate the distance.
    sd[i] = Math.max(sd[i], 0.15);
  }

  // Pitch statistics from confidently-voiced frames only.
  const pitches = use
    .filter((f) => f.pitch > 0 && f.clarity >= PITCH_CLARITY)
    .map((f) => f.pitch);
  const pm = median(pitches);
  const ps = Math.max(std(pitches, mean(pitches)), 10);
  const pmin = pitches.length ? Math.min(...pitches) : 0;
  const pmax = pitches.length ? Math.max(...pitches) : 0;

  const centroidHz = mean(use.map((f) => f.centroidHz));
  const voicedFrames = voiced.length;

  return {
    name,
    mean: mn,
    std: sd,
    pitchMean: pm,
    pitchStd: ps,
    pitchMin: pmin,
    pitchMax: pmax,
    centroidHz,
    voicedFrames,
    voicedSec: 0, // filled in by the caller (knows the frame interval)
  };
}

/** Was there enough voiced signal in this clip to trust the profile? */
export function enrollQuality(frames: VoiceFrame[]): number {
  const voiced = frames.filter((f) => f.rms > VOICE_RMS).length;
  return frames.length ? voiced / frames.length : 0;
}

// ---------- matching ----------

export type MatchResult = {
  idx: number; // best-fitting profile index
  conf: number; // 0.5..1 — how decisively the winner beat the runner-up
  scores: number[]; // per-profile fit 0..1
  pitch: number; // measured pitch of this window (0 if unvoiced)
};

/** Mean diagonal-Gaussian log-likelihood of a window's timbre under a profile. */
function timbreFit(vec: number[], p: VoiceProfile): number {
  let z2 = 0;
  for (let i = 0; i < vec.length; i++) {
    const z = (vec[i] - p.mean[i]) / p.std[i];
    z2 += z * z;
  }
  // Average squared z-score -> likelihood in (0,1]. /2 softens the falloff.
  return Math.exp(-0.5 * (z2 / vec.length) / 2);
}

function pitchFit(pitch: number, p: VoiceProfile): number {
  if (pitch <= 0 || p.pitchMean <= 0) return 0.5; // neutral when unknown
  const z = (pitch - p.pitchMean) / p.pitchStd;
  return Math.exp(-0.5 * z * z);
}

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

  // Average the timbre vectors across the window for a stable estimate.
  const vecs = voiced.map(timbreVec);
  const dim = TIMBRE_DIM;
  const avg = new Array<number>(dim).fill(0);
  for (const v of vecs) for (let i = 0; i < dim; i++) avg[i] += v[i];
  for (let i = 0; i < dim; i++) avg[i] /= vecs.length;

  const pitches = voiced
    .filter((f) => f.pitch > 0 && f.clarity >= PITCH_CLARITY)
    .map((f) => f.pitch);
  const pm = pitches.length ? median(pitches) : 0;

  // Pitch is the single most discriminative voice cue, so it carries more weight
  // than timbre — but only when we actually measured a confident pitch.
  const wPitch = pm > 0 ? 0.55 : 0;
  const wTimbre = 1 - wPitch;

  const scores = profiles.map((p) => {
    const t = timbreFit(avg, p);
    const pit = pitchFit(pm, p);
    return wTimbre * t + wPitch * pit;
  });

  let bi = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[bi]) bi = i;
  const sorted = [...scores].sort((a, b) => b - a);
  const top = sorted[0];
  const second = sorted.length > 1 ? sorted[1] : 0;
  // Confidence = how cleanly the winner separates from the runner-up, 0.5..1.
  const conf = top + second > 0 ? top / (top + second) : 0.5;

  return { idx: bi, conf, scores, pitch: pm };
}

// ---------- human-readable descriptors ----------

export type VoiceDescriptor = {
  register: string; // e.g. "Deep", "Low", "Mid", "High"
  tone: string; // e.g. "Warm", "Balanced", "Bright"
  summary: string; // one-line: "Deep · Warm"
  pitchLabel: string; // "112 Hz" or "—"
  rangeLabel: string; // "98–134 Hz"
};

/** Turn a profile's raw numbers into a plain-language voice description. */
export function describeVoice(p: VoiceProfile): VoiceDescriptor {
  const hz = p.pitchMean;
  let register = "Mid";
  if (hz <= 0) register = "—";
  else if (hz < 115) register = "Deep";
  else if (hz < 150) register = "Low";
  else if (hz < 185) register = "Mid";
  else if (hz < 230) register = "High";
  else register = "Bright";

  // centroidHz roughly 800–1400 = warm, 1400–2200 = balanced, >2200 = bright.
  const c = p.centroidHz;
  let tone = "Balanced";
  if (c < 1400) tone = "Warm";
  else if (c > 2200) tone = "Crisp";

  const pitchLabel = hz > 0 ? `${Math.round(hz)} Hz` : "—";
  const rangeLabel =
    p.pitchMin > 0 && p.pitchMax > 0
      ? `${Math.round(p.pitchMin)}–${Math.round(p.pitchMax)} Hz`
      : "—";

  return {
    register,
    tone,
    summary: hz > 0 ? `${register} · ${tone}` : tone,
    pitchLabel,
    rangeLabel,
  };
}

export type Separation = {
  score: number; // 0..1 — how distinguishable the two voices are
  label: string; // "Easily distinguishable" / "Distinct" / "Similar voices"
  ok: boolean; // false -> suggest re-recording for reliable attribution
};

/**
 * How acoustically distinct two profiles are. Combines pitch gap (in the
 * voices' own spread) with timbre separation, so the UI can warn when two
 * voices are too alike to attribute reliably.
 */
export function profileSeparation(a: VoiceProfile, b: VoiceProfile): Separation {
  // Pitch distance in pooled standard deviations.
  let pitchSep = 0;
  if (a.pitchMean > 0 && b.pitchMean > 0) {
    const pooled = Math.sqrt((a.pitchStd ** 2 + b.pitchStd ** 2) / 2) || 1;
    pitchSep = Math.abs(a.pitchMean - b.pitchMean) / pooled;
  }

  // Timbre distance in pooled per-dimension std.
  let z2 = 0;
  for (let i = 0; i < a.mean.length; i++) {
    const pooled = Math.sqrt((a.std[i] ** 2 + b.std[i] ** 2) / 2) || 1;
    const z = (a.mean[i] - b.mean[i]) / pooled;
    z2 += z * z;
  }
  const timbreSep = Math.sqrt(z2 / a.mean.length);

  // Blend; ~1.0+ combined std of separation is comfortably distinguishable.
  const raw = 0.6 * pitchSep + 0.9 * timbreSep;
  const score = Math.max(0, Math.min(1, raw / 2.2));

  let label = "Similar voices";
  let ok = false;
  if (score >= 0.66) {
    label = "Easily distinguishable";
    ok = true;
  } else if (score >= 0.4) {
    label = "Distinct enough";
    ok = true;
  }
  return { score, label, ok };
}
