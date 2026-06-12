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
// Smoothing is for the UI meter ONLY — switching is driven by the raw per-frame
// posterior so a real turn change isn't crushed below the margin by the EMA.
const SMOOTH = 0.6; // weight on the previous presence estimate (display only)
const SEED_MARGIN = 0.08; // posterior gap needed to first seat a speaker
const SWITCH_MARGIN = 0.12; // raw posterior gap the challenger must show to flip
const DWELL_FRAMES = 3; // ...sustained for this many frames (~180ms @ 60ms)
const SILENCE_HOLD_MS = 600; // keep showing the last speaker briefly after speech

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
  private challenger: SpeakerIdx | null = null;
  private challengerFrames = 0;

  constructor(profiles: VoiceProfile[], names: [string, string]) {
    this.profiles = profiles;
    this.names = names;
  }

  /** Sample one audio frame and update live speaker detection. */
  tick(frame: VoiceFrame): SpeakerIdx | null {
    const buf = this.frameBuf;
    buf.push(frame);
    // ~360ms window: long enough to be stable, short enough that one window
    // rarely straddles a turn boundary (which used to smear attribution).
    if (buf.length > 6) buf.shift();

    const now = Date.now();
    const m = matchWindow(buf, this.profiles);

    if (!m) {
      // Silence: let presence decay; drop the active speaker after a short hold.
      this.presence[0] *= 0.9;
      this.presence[1] *= 0.9;
      this.challengerFrames = 0;
      if (now - this.lastVoiced > SILENCE_HOLD_MS) this.active = null;
      return this.active;
    }

    this.lastVoiced = now;
    this.pitch = m.pitch;

    // m.scores are posteriors that sum to 1 — the gap is a real 0..1 contrast.
    const lead: SpeakerIdx = m.scores[0] >= m.scores[1] ? 0 : 1;
    const gap = Math.abs(m.scores[0] - m.scores[1]);
    this.conf = m.conf;

    // Smooth for the UI meter only (NOT for the switch decision).
    this.presence[0] = this.presence[0] * SMOOTH + m.scores[0] * (1 - SMOOTH);
    this.presence[1] = this.presence[1] * SMOOTH + m.scores[1] * (1 - SMOOTH);

    // Dwell counter: how many consecutive frames the same challenger has led.
    if (lead === this.challenger) this.challengerFrames++;
    else {
      this.challenger = lead;
      this.challengerFrames = 1;
    }

    if (this.active === null) {
      // Seat the first speaker only on a real lead, so a noisy first frame
      // can't permanently mis-seat attribution.
      if (gap > SEED_MARGIN) this.active = lead;
    } else if (lead !== this.active) {
      // Flip when the challenger has led clearly AND for long enough.
      if (this.challengerFrames >= DWELL_FRAMES && gap > SWITCH_MARGIN) {
        this.active = lead;
      }
    }

    // Record the RAW per-frame lead (not the latched `active`) so pickSpeaker can
    // overrule a wrong lock from the accumulated per-frame evidence.
    this.decisions.push({ t: now, idx: lead, conf: m.conf });
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
