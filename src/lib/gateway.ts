// Speaker gateway: one mic + two enrolled voice profiles.
//
// Voice frames -> match decisions -> STT final phrases get routed into one of
// two per-speaker transcript lanes. LARP scoring reads from those lanes only.

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

const DECISION_TTL_MS = 20_000;
const ATTRIBUTION_LOOKBACK_MS = 15_000;

export class SpeakerGateway {
  private profiles: VoiceProfile[];
  private names: [string, string];
  private frameBuf: VoiceFrame[] = [];
  private decisions: { t: number; idx: SpeakerIdx; conf: number }[] = [];
  private lanes: [RoutedPhrase[], RoutedPhrase[]] = [[], []];
  private log: LabeledLine[] = [];
  private lastFinal = Date.now();
  private active: SpeakerIdx | null = null;

  constructor(profiles: VoiceProfile[], names: [string, string]) {
    this.profiles = profiles;
    this.names = names;
  }

  /** Sample one audio frame and update live speaker detection. */
  tick(frame: VoiceFrame): SpeakerIdx | null {
    const buf = this.frameBuf;
    buf.push(frame);
    if (buf.length > 12) buf.shift();

    const m = matchWindow(buf, this.profiles);
    const now = Date.now();
    if (!m) {
      this.active = null;
      return null;
    }

    this.decisions.push({ t: now, idx: m.idx as SpeakerIdx, conf: m.conf });
    const cut = now - DECISION_TTL_MS;
    while (this.decisions.length && this.decisions[0].t < cut) {
      this.decisions.shift();
    }
    this.active = m.idx as SpeakerIdx;
    return this.active;
  }

  getActive(): SpeakerIdx | null {
    return this.active;
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

  private pickSpeaker(): { speaker: SpeakerIdx; conf: number } {
    const since = Math.max(this.lastFinal, Date.now() - ATTRIBUTION_LOOKBACK_MS);
    const recent = this.decisions.filter((d) => d.t >= since);
    const pool = recent.length ? recent : this.decisions.slice(-8);

    let a = 0;
    let b = 0;
    let confSum = 0;
    for (const d of pool) {
      const w = 0.4 + d.conf;
      confSum += d.conf;
      if (d.idx === 0) a += w;
      else b += w;
    }

    const speaker: SpeakerIdx = b > a ? 1 : 0;
    const conf = pool.length ? confSum / pool.length : 0.5;
    return { speaker, conf };
  }
}
