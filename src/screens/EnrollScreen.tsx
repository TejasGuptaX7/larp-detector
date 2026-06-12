import { useEffect, useRef, useState } from "react";
import { ensureMic, setProfiles } from "../lib/session";
import { ENROLL_LINES } from "../lib/enrollLines";
import {
  buildProfile,
  enrollQuality,
  type VoiceEngine,
  type VoiceFrame,
  type VoiceProfile,
} from "../lib/voice";

type Props = { onReady: () => void };

type Slot = {
  name: string;
  color: string;
  profile: VoiceProfile | null;
  quality: number; // 0..1 voiced ratio
};

const SAMPLE_MS = 4000;
const FRAME_MS = 50;

const INIT: Slot[] = [
  { name: "A", color: "var(--low)", profile: null, quality: 0 },
  { name: "B", color: "var(--high)", profile: null, quality: 0 },
];

export function EnrollScreen({ onReady }: Props) {
  const [slots, setSlots] = useState<Slot[]>(INIT);
  const [recording, setRecording] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [level, setLevel] = useState(0);
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

  function record(idx: number) {
    const e = engine.current;
    if (!e || recording !== null) return;
    setRecording(idx);
    setProgress(0);

    const frames: VoiceFrame[] = [];
    const start = Date.now();

    const id = setInterval(() => {
      const f = e.frame();
      frames.push(f);
      setLevel(Math.min(1, f.rms * 14));
      const p = Math.min(1, (Date.now() - start) / SAMPLE_MS);
      setProgress(p);

      if (p >= 1) {
        clearInterval(id);
        setLevel(0);
        setRecording(null);
        setSlots((prev) => {
          const next = [...prev];
          const slot = next[idx];
          const profile = buildProfile(slot.name || (idx === 0 ? "A" : "B"), frames);
          next[idx] = {
            ...slot,
            profile,
            quality: enrollQuality(frames),
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
        <div className="enroll-sub">Enroll both voices. Each person reads their line aloud.</div>
      </div>

      {micError && (
        <div className="enroll-err">Microphone blocked — allow access and reload.</div>
      )}

      <div className="enroll-grid">
        {slots.map((slot, i) => {
          const isRec = recording === i;
          return (
            <div
              className={`enroll-card${slot.profile ? " enroll-done" : ""}`}
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
                    width: `${(isRec ? level : slot.profile ? slot.quality : 0) * 100}%`,
                    background: slot.color,
                  }}
                />
              </div>

              {slot.profile ? (
                <div className="enroll-status">
                  <span className="enroll-pitch">
                    {Math.round(slot.profile.pitchMean)} Hz
                  </span>
                  <span className="enroll-q">{Math.round(slot.quality * 100)}% voiced</span>
                </div>
              ) : (
                <div className="enroll-status enroll-status-idle">
                  {isRec ? `listening ${Math.round(progress * 100)}%` : "not enrolled"}
                </div>
              )}

              <button
                className="enroll-rec"
                disabled={recording !== null || micError}
                onClick={() => record(i)}
                style={{ borderColor: slot.color }}
              >
                {isRec ? "RECORDING…" : slot.profile ? "RE-RECORD" : "RECORD VOICE"}
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
