// Speaker gateway: one mic + two enrolled voice profiles.
//
// Voice frames -> smoothed match decisions -> STT final phrases get routed into
// one of two per-speaker transcript lanes. LARP scoring reads from those lanes
// only.
//
// Stability is the whole game here. A raw frame-by-frame match flickers between
// A and B many times a second. We fix that two ways:
//   1. Exponential smoothing of each speaker's "presence" score.
//   2. Hysteresis — we only flip the active speaker when the challenger leads by
//      a margin, so brief acoustic noise can't steal the turn.

import type { VoiceFrame, VoiceProfile } from "./voice";
import { matchWindow } from "./voice";

export type SpeakerIdx = 0 | 1;

export type RoutedPhrase = {
  t: number;
  speaker: SpeakerIdx;
  text: string;
  conf: number;
};

export type LabeledLine = {
  t: number;
  speaker: SpeakerIdx;
  name: string;
  text: string;
  conf: number;
};

export type LiveState = {
  active: SpeakerIdx | null;
  presence: [number, number]; // smoothed 0..1 fit per speaker
  conf: number; // 0.5..1 separation of the leader
  pitch: number; // Hz of the current window (0 when unvoiced)
};

const DECISION_TTL_MS = 20_000;
const ATTRIBUTION_LOOKBACK_MS = 15_000;
// Smoothing + hysteresis tuning.
const SMOOTH = 0.72; // weight on the previous presence estimate
const SWITCH_MARGIN = 0.08; // challenger must lead the active speaker by this
const SILENCE_HOLD_MS = 700; // keep showing the last speaker briefly after speech

export class SpeakerGateway {
  private profiles: VoiceProfile[];
  private names: [string, string];
  private frameBuf: VoiceFrame[] = [];
  private decisions: { t: number; idx: SpeakerIdx; conf: number }[] = [];
  private lanes: [RoutedPhrase[], RoutedPhrase[]] = [[], []];
  private log: LabeledLine[] = [];
  private lastFinal = Date.now();
  private lastVoiced = 0;
  private active: SpeakerIdx | null = null;
  private presence: [number, number] = [0, 0];
  private conf = 0.5;
  private pitch = 0;

  constructor(profiles: VoiceProfile[], names: [string, string]) {
    this.profiles = profiles;
    this.names = names;
  }

  /** Sample one audio frame and update live speaker detection. */
  tick(frame: VoiceFrame): SpeakerIdx | null {
    const buf = this.frameBuf;
    buf.push(frame);
    if (buf.length > 14) buf.shift();

    const now = Date.now();
    const m = matchWindow(buf, this.profiles);

    if (!m) {
      // Silence: let presence decay; drop the active speaker after a short hold.
      this.presence[0] *= 0.9;
      this.presence[1] *= 0.9;
      if (now - this.lastVoiced > SILENCE_HOLD_MS) this.active = null;
      return this.active;
    }

    this.lastVoiced = now;
    this.pitch = m.pitch;

    // Smooth each speaker's instantaneous fit.
    this.presence[0] = this.presence[0] * SMOOTH + m.scores[0] * (1 - SMOOTH);
    this.presence[1] = this.presence[1] * SMOOTH + m.scores[1] * (1 - SMOOTH);

    const lead = this.presence[0] >= this.presence[1] ? 0 : 1;
    const gap = Math.abs(this.presence[0] - this.presence[1]);
    this.conf = m.conf;

    // Hysteresis: switch only when the leader clears the active speaker by a
    // margin (or when there's no active speaker yet).
    if (this.active === null) {
      this.active = lead as SpeakerIdx;
    } else if (lead !== this.active && gap > SWITCH_MARGIN) {
      this.active = lead as SpeakerIdx;
    }

    this.decisions.push({ t: now, idx: this.active, conf: m.conf });
    const cut = now - DECISION_TTL_MS;
    while (this.decisions.length && this.decisions[0].t < cut) {
      this.decisions.shift();
    }
    return this.active;
  }

  getActive(): SpeakerIdx | null {
    return this.active;
  }

  liveState(): LiveState {
    return {
      active: this.active,
      presence: [this.presence[0], this.presence[1]],
      conf: this.conf,
      pitch: this.pitch,
    };
  }

  /** Route a finalized STT phrase into the correct speaker lane. */
  routeFinal(text: string): LabeledLine {
    const trimmed = text.trim();
    const { speaker, conf } = this.pickSpeaker();
    const line: LabeledLine = {
      t: Date.now(),
      speaker,
      name: this.names[speaker],
      text: trimmed,
      conf,
    };
    this.lanes[speaker].push({ t: line.t, speaker, text: trimmed, conf });
    this.log.push(line);
    this.lastFinal = line.t;
    return line;
  }

  getLane(speaker: SpeakerIdx): readonly RoutedPhrase[] {
    return this.lanes[speaker];
  }

  getLog(): readonly LabeledLine[] {
    return this.log;
  }

  /** Rolling transcript text for one speaker (for LARP scoring). */
  windowText(speaker: SpeakerIdx, windowMs: number, now = Date.now()): string {
    const cut = now - windowMs;
    this.lanes[speaker] = this.lanes[speaker].filter((p) => p.t >= cut);
    return this.lanes[speaker].map((p) => p.text).join(" ");
  }

  /**
   * Attribute a just-finalized phrase. We tally the smoothed per-frame decisions
   * over the phrase's lifetime (since the previous final), weighted by how
   * confident each was, and take the dominant speaker.
   */
  private pickSpeaker(): { speaker: SpeakerIdx; conf: number } {
    const since = Math.max(this.lastFinal, Date.now() - ATTRIBUTION_LOOKBACK_MS);
    const recent = this.decisions.filter((d) => d.t >= since);
    const pool = recent.length ? recent : this.decisions.slice(-10);

    let a = 0;
    let b = 0;
    let confSum = 0;
    for (const d of pool) {
      const w = 0.3 + d.conf;
      confSum += d.conf;
      if (d.idx === 0) a += w;
      else b += w;
    }

    // Fall back to the current active speaker if the pool was empty.
    const speaker: SpeakerIdx =
      a === 0 && b === 0 ? (this.active ?? 0) : b > a ? 1 : 0;
    const conf = pool.length ? confSum / pool.length : 0.5;
    return { speaker, conf };
  }
}
