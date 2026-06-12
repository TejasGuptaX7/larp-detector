import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ensureMic, setProfiles } from "../lib/session";
import { ENROLL_LINES } from "../lib/enrollLines";
import {
  buildProfile,
  describeVoice,
  profileSeparation,
  VOICED_GATE,
  type VoiceEngine,
  type VoiceFrame,
  type VoiceProfile,
} from "../lib/voice";

type Props = { onReady: () => void };

type Slot = {
  name: string;
  color: string;
  profile: VoiceProfile | null;
};

const FRAME_MS = 50;
// Enrollment finishes when we have this much ACTUAL SPEECH — not wall time.
// The clock only runs while the person is talking, so pauses can't truncate it.
const TARGET_VOICED_FRAMES = 70; // ~3.5s of voiced audio
const MAX_MS = 18_000; // hard cap so it can't run forever

const INIT: Slot[] = [
  { name: "Person 1", color: "var(--p1)", profile: null },
  { name: "Person 2", color: "var(--p2)", profile: null },
];

// Pitch scale used by the little register meter (covers low male -> high female).
const PITCH_LO = 75;
const PITCH_HI = 285;

export function EnrollScreen({ onReady }: Props) {
  const [slots, setSlots] = useState<Slot[]>(INIT);
  const [recording, setRecording] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [level, setLevel] = useState(0);
  const [hint, setHint] = useState("");
  const [micError, setMicError] = useState(false);

  const engine = useRef<VoiceEngine | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { engine: e } = await ensureMic();
        if (!cancelled) engine.current = e;
      } catch (err) {
        console.error("mic open failed", err);
        if (!cancelled) setMicError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // mic stays open; the live screen reuses it via the session store.
  }, []);

  // Idle VU meter so people can see the mic hears them before recording.
  useEffect(() => {
    const id = setInterval(() => {
      if (recording !== null) return;
      const e = engine.current;
      if (!e) return;
      setLevel(Math.min(1, e.frame().rms * 16));
    }, 90);
    return () => clearInterval(id);
  }, [recording]);

  function record(idx: number) {
    const e = engine.current;
    if (!e || recording !== null) return;
    setRecording(idx);
    setProgress(0);
    setHint("Read your line — keep going until the ring fills");

    const frames: VoiceFrame[] = [];
    let voiced = 0;
    const start = Date.now();

    const id = setInterval(() => {
      const f = e.frame();
      frames.push(f);
      if (f.rms > VOICED_GATE) voiced++;
      setLevel(Math.min(1, f.rms * 16));

      const p = Math.min(1, voiced / TARGET_VOICED_FRAMES);
      setProgress(p);
      if (p < 0.15 && Date.now() - start > 2500) {
        setHint("Can't hear you — speak louder or move closer");
      } else if (p >= 0.15 && p < 1) {
        setHint("Keep reading…");
      }

      const timedOut = Date.now() - start > MAX_MS;
      if (p >= 1 || timedOut) {
        clearInterval(id);
        setLevel(0);
        setRecording(null);
        setHint("");

        // Not enough actual speech captured -> reject, ask to retry.
        if (voiced < TARGET_VOICED_FRAMES * 0.6) {
          setSlots((prev) => {
            const next = [...prev];
            next[idx] = { ...next[idx], profile: null };
            return next;
          });
          setHint("Too quiet — try again, closer to the mic");
          return;
        }

        setSlots((prev) => {
          const next = [...prev];
          const slot = next[idx];
          const profile = buildProfile(
            slot.name || (idx === 0 ? "Person 1" : "Person 2"),
            frames,
          );
          profile.voicedSec = (voiced * FRAME_MS) / 1000;
          next[idx] = { ...slot, profile };
          return next;
        });
      }
    }, FRAME_MS);
  }

  function rename(idx: number, name: string) {
    setSlots((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], name };
      // keep the profile label in sync with the typed name
      if (next[idx].profile) next[idx].profile = { ...next[idx].profile!, name };
      return next;
    });
  }

  function start() {
    const profiles = slots
      .map((s) => s.profile)
      .filter(Boolean) as VoiceProfile[];
    if (profiles.length < 2) return;
    setProfiles(profiles);
    onReady();
  }

  const bothReady = slots.every((s) => s.profile);
  const sep =
    slots[0].profile && slots[1].profile
      ? profileSeparation(slots[0].profile, slots[1].profile)
      : null;

  return (
    <div className="enroll">
      <div className="enroll-top">
        <span className="kicker">Step 1 — Voice setup</span>
        <h1 className="enroll-title">Teach it both voices.</h1>
      </div>

      {micError && (
        <div className="enroll-err">
          Microphone blocked — allow access and reload.
        </div>
      )}

      {!micError && (
        <div className="enroll-vu">
          <span className="enroll-vu-k">Mic</span>
          <div className="enroll-vu-track">
            <div className="enroll-vu-fill" style={{ width: `${level * 100}%` }} />
          </div>
          <span className="enroll-vu-hint">{hint || "say something to test the level"}</span>
        </div>
      )}

      <div className="enroll-grid">
        {slots.map((slot, i) => {
          const isRec = recording === i;
          const prof = slot.profile;
          return (
            <div
              className={`enroll-card${prof ? " enroll-done" : ""}${isRec ? " enroll-active" : ""}`}
              key={i}
              style={{ "--seat": slot.color } as CSSProperties}
            >
              <div className="enroll-card-head">
                <span className="enroll-seat">{i + 1}</span>
                <input
                  className="enroll-name"
                  value={slot.name}
                  spellCheck={false}
                  maxLength={16}
                  onChange={(ev) => rename(i, ev.target.value)}
                  placeholder={i === 0 ? "Person 1" : "Person 2"}
                />
                {prof && <span className="enroll-check">enrolled</span>}
              </div>

              {prof ? (
                <VoiceProfileView profile={prof} color={slot.color} />
              ) : (
                <div className="enroll-read">
                  <div className="enroll-read-line">{ENROLL_LINES[i].line}</div>
                </div>
              )}

              <div className="enroll-meter">
                <div
                  className="enroll-meter-fill"
                  style={{
                    width: `${(isRec ? progress : prof ? 1 : 0) * 100}%`,
                    background: slot.color,
                  }}
                />
              </div>

              <button
                className="enroll-rec"
                disabled={recording !== null || micError}
                onClick={() => record(i)}
              >
                {isRec
                  ? `Listening… ${Math.round(progress * 100)}%`
                  : prof
                    ? "Re-record"
                    : "Record voice"}
              </button>
            </div>
          );
        })}
      </div>

      {sep && (
        <div className={`enroll-sep${sep.ok ? "" : " warn"}`}>
          <span className="enroll-sep-dot" />
          <span className="enroll-sep-label">{sep.label}</span>
          <div className="enroll-sep-track">
            <div
              className="enroll-sep-fill"
              style={{ width: `${Math.round(sep.score * 100)}%` }}
            />
          </div>
          <span className="enroll-sep-hint">
            {sep.ok
              ? "the detector can tell these two apart"
              : "voices are close — re-record longer for reliable attribution"}
          </span>
        </div>
      )}

      <button className="btn-primary enroll-go" disabled={!bothReady} onClick={start}>
        {bothReady ? "Start the detector →" : "Enroll both voices to continue"}
      </button>
    </div>
  );
}

/** Detailed, legible readout of a single enrolled voice. */
function VoiceProfileView({
  profile,
  color,
}: {
  profile: VoiceProfile;
  color: string;
}) {
  const d = describeVoice(profile);
  const pos = (hz: number) =>
    Math.max(0, Math.min(1, (hz - PITCH_LO) / (PITCH_HI - PITCH_LO)));
  const markerPos = profile.pitchMean > 0 ? pos(profile.pitchMean) : 0;
  const bandLo = profile.pitchMin > 0 ? pos(profile.pitchMin) : markerPos;
  const bandHi = profile.pitchMax > 0 ? pos(profile.pitchMax) : markerPos;

  return (
    <div className="vp">
      <div className="vp-summary" style={{ color }}>
        {d.summary}
      </div>

      {/* register meter: where this voice sits on a low->high pitch scale */}
      <div className="vp-scale">
        <div className="vp-scale-track">
          <div
            className="vp-scale-band"
            style={{
              left: `${bandLo * 100}%`,
              width: `${Math.max(2, (bandHi - bandLo) * 100)}%`,
              background: color,
            }}
          />
          <div
            className="vp-scale-marker"
            style={{ left: `${markerPos * 100}%`, background: color }}
          />
        </div>
        <div className="vp-scale-ends">
          <span>low</span>
          <span>high</span>
        </div>
      </div>

      {/* unique timbre fingerprint */}
      <div className="vp-print">
        {profile.mean.map((v, i) => {
          const h = 0.18 + Math.min(0.82, Math.abs(v) / 14);
          return (
            <span
              className="vp-bar"
              key={i}
              style={{ height: `${h * 100}%`, background: color }}
            />
          );
        })}
      </div>

      <div className="vp-stats">
        <div className="vp-stat">
          <span className="vp-stat-k">Pitch</span>
          <span className="vp-stat-v">{d.pitchLabel}</span>
        </div>
        <div className="vp-stat">
          <span className="vp-stat-k">Range</span>
          <span className="vp-stat-v">{d.rangeLabel}</span>
        </div>
        <div className="vp-stat">
          <span className="vp-stat-k">Tone</span>
          <span className="vp-stat-v">{d.tone}</span>
        </div>
        <div className="vp-stat">
          <span className="vp-stat-k">Captured</span>
          <span className="vp-stat-v">{profile.voicedSec.toFixed(1)}s</span>
        </div>
      </div>
    </div>
  );
}
