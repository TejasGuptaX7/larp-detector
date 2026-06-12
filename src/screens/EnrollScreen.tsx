import { useEffect, useRef, useState } from "react";
import { ensureMic, setProfiles } from "../lib/session";
import { ENROLL_LINES } from "../lib/enrollLines";
import {
  buildProfile,
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
  voicedSec: number; // seconds of actual speech captured
};

const FRAME_MS = 50;
// Enrollment finishes when we have this much ACTUAL SPEECH — not wall time.
// The clock only runs while the person is talking, so pauses can't truncate it.
const TARGET_VOICED_FRAMES = 56; // ~2.8s of voiced audio
const MAX_MS = 15_000; // hard cap so it can't run forever

const INIT: Slot[] = [
  { name: "A", color: "var(--low)", profile: null, voicedSec: 0 },
  { name: "B", color: "var(--high)", profile: null, voicedSec: 0 },
];

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
      setLevel(Math.min(1, e.frame().rms * 18));
    }, 90);
    return () => clearInterval(id);
  }, [recording]);

  function record(idx: number) {
    const e = engine.current;
    if (!e || recording !== null) return;
    setRecording(idx);
    setProgress(0);
    setHint("Speak now — keep going until the bar fills");

    const frames: VoiceFrame[] = [];
    let voiced = 0;
    const start = Date.now();

    const id = setInterval(() => {
      const f = e.frame();
      frames.push(f);
      if (f.rms > VOICED_GATE) voiced++;
      setLevel(Math.min(1, f.rms * 18));

      const p = Math.min(1, voiced / TARGET_VOICED_FRAMES);
      setProgress(p);
      if (p < 0.15 && Date.now() - start > 2500) {
        setHint("Can't hear you — speak louder or move closer");
      } else if (p >= 0.15) {
        setHint("Keep talking…");
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
            next[idx] = { ...next[idx], profile: null, voicedSec: 0 };
            return next;
          });
          setHint("Too quiet — try again, closer to the mic");
          return;
        }

        setSlots((prev) => {
          const next = [...prev];
          const slot = next[idx];
          const profile = buildProfile(slot.name || (idx === 0 ? "A" : "B"), frames);
          next[idx] = {
            ...slot,
            profile,
            voicedSec: (voiced * FRAME_MS) / 1000,
          };
          return next;
        });
      }
    }, FRAME_MS);
  }

  function rename(idx: number, name: string) {
    setSlots((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], name };
      return next;
    });
  }

  function start() {
    const profiles = slots.map((s) => s.profile).filter(Boolean) as VoiceProfile[];
    if (profiles.length < 2) return;
    setProfiles(profiles);
    onReady();
  }

  const bothReady = slots.every((s) => s.profile);

  return (
    <div className="enroll">
      <div className="enroll-top">
        <div className="enroll-mark">VOICE SETUP</div>
        <div className="enroll-sub">
          Each person reads their line aloud — the bar fills as we hear you.
        </div>
      </div>

      {micError && (
        <div className="enroll-err">Microphone blocked — allow access and reload.</div>
      )}

      {!micError && (
        <div className="enroll-vu">
          <span className="enroll-vu-k">MIC</span>
          <div className="enroll-vu-track">
            <div className="enroll-vu-fill" style={{ width: `${level * 100}%` }} />
          </div>
          <span className="enroll-vu-hint">{hint || "say something to test"}</span>
        </div>
      )}

      <div className="enroll-grid">
        {slots.map((slot, i) => {
          const isRec = recording === i;
          return (
            <div
              className={`enroll-card${slot.profile ? " enroll-done" : ""}${isRec ? " enroll-active" : ""}`}
              key={i}
              style={{ outlineColor: slot.color }}
            >
              <div className="enroll-seat" style={{ color: slot.color }}>
                {i === 0 ? "A" : "B"}
              </div>

              <input
                className="enroll-name"
                value={slot.name}
                spellCheck={false}
                maxLength={14}
                onChange={(ev) => rename(i, ev.target.value)}
                placeholder={i === 0 ? "Person A" : "Person B"}
              />

              <div className="enroll-read">
                <div className="enroll-read-k">{ENROLL_LINES[i].label}</div>
                <div className="enroll-read-line">{ENROLL_LINES[i].line}</div>
              </div>

              <div className="enroll-meter">
                <div
                  className="enroll-meter-fill"
                  style={{
                    width: `${(isRec ? progress : slot.profile ? 1 : 0) * 100}%`,
                    background: slot.color,
                  }}
                />
              </div>

              {slot.profile ? (
                <div className="enroll-status">
                  <span className="enroll-pitch">
                    {Math.round(slot.profile.pitchMean)} Hz
                  </span>
                  <span className="enroll-q">
                    {slot.voicedSec.toFixed(1)}s of voice locked
                  </span>
                </div>
              ) : (
                <div className="enroll-status enroll-status-idle">
                  {isRec ? `capturing speech ${Math.round(progress * 100)}%` : "not enrolled"}
                </div>
              )}

              <button
                className="enroll-rec"
                disabled={recording !== null || micError}
                onClick={() => record(i)}
                style={{ borderColor: slot.color }}
              >
                {isRec ? "LISTENING…" : slot.profile ? "RE-RECORD" : "RECORD VOICE"}
              </button>
            </div>
          );
        })}
      </div>

      <button className="btn-start enroll-go" disabled={!bothReady} onClick={start}>
        {bothReady ? "Start Detector" : "Enroll both voices"}
      </button>
    </div>
  );
}
