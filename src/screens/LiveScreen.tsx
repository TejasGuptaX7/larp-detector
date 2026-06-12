import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Waveform } from "../components/Waveform";
import { Gauge } from "../components/Gauge";
import { verdict } from "../lib/score";
import { scoreL1 } from "../lib/larp";
import { startTranscription } from "../lib/transcribe";
import type { SttHandle, SttStatus } from "../lib/stt";
import { callJudge } from "../lib/judgeClient";
import { getEngine, getMic, getProfiles, getStream } from "../lib/session";
import { SpeakerGateway, type LabeledLine } from "../lib/gateway";
import { describeVoice, type VoiceEngine } from "../lib/voice";
import { ConvoRecorder, type Recording } from "../lib/recorder";
import { Summary } from "./Summary.tsx";
import type { Line } from "./Summary.tsx";

type Props = { onStop: () => void };

type Lane = {
  name: string;
  color: string;
  score: number;
  tags: string[];
  words: number;
  l2: number | null;
};

type Detect = {
  active: 0 | 1 | null;
  presence: [number, number];
  conf: number;
  pitch: number;
};

const WINDOW_MS = 30_000;
const L2_INTERVAL_MS = 12_000;
const FRAME_MS = 60;
const COLORS = ["var(--p1)", "var(--p2)"];

export function LiveScreen({ onStop }: Props) {
  const profiles = getProfiles();
  const names: [string, string] = [
    profiles[0]?.name || "Person 1",
    profiles[1]?.name || "Person 2",
  ];
  const subtitles: [string, string] = [
    profiles[0] ? describeVoice(profiles[0]).summary : "",
    profiles[1] ? describeVoice(profiles[1]).summary : "",
  ];

  const [lanes, setLanes] = useState<Lane[]>(() => [
    { name: names[0], color: COLORS[0], score: 0, tags: [], words: 0, l2: null },
    { name: names[1], color: COLORS[1], score: 0, tags: [], words: 0, l2: null },
  ]);
  const [elapsed, setElapsed] = useState(0);
  const [sttStatus, setSttStatus] = useState<SttStatus>("off");
  const [sttDetail, setSttDetail] = useState("");
  const [judgeOn, setJudgeOn] = useState(false);
  const [caption, setCaption] = useState("");
  const [detect, setDetect] = useState<Detect>({
    active: null,
    presence: [0, 0],
    conf: 0.5,
    pitch: 0,
  });
  const [feed, setFeed] = useState<LabeledLine[]>([]);
  const [summary, setSummary] = useState<{
    lines: Line[];
    rec: Recording | null;
    scores: [number, number];
  } | null>(null);

  const analyser = useRef<AnalyserNode | null>(getMic()?.analyser ?? null);
  const engine = useRef<VoiceEngine | null>(getEngine());
  const stt = useRef<SttHandle | null>(null);
  const recorder = useRef<ConvoRecorder | null>(null);
  const feedEnd = useRef<HTMLDivElement>(null);
  // Set once the session ends: halts the per-frame work so we don't keep running
  // the voice engine behind the summary screen (LiveScreen stays mounted).
  const ended = useRef(false);
  const gateway = useRef<SpeakerGateway | null>(
    profiles.length >= 2 ? new SpeakerGateway(profiles, names) : null,
  );

  useEffect(() => {
    if (profiles.length < 2 || !engine.current || !gateway.current) {
      onStop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const stream = getStream();
    if (!stream) return;
    const r = new ConvoRecorder(stream);
    r.start();
    recorder.current = r;
    return () => {
      void r.stop();
    };
  }, []);

  // Voice gateway: match each frame -> live "who is speaking".
  useEffect(() => {
    const e = engine.current;
    const gw = gateway.current;
    if (!e || !gw) return;
    const id = setInterval(() => {
      if (ended.current) return;
      gw.tick(e.frame());
      const s = gw.liveState();
      setDetect({
        active: s.active,
        presence: s.presence,
        conf: s.conf,
        pitch: s.pitch,
      });
    }, FRAME_MS);
    return () => clearInterval(id);
  }, []);

  // Transcription -> gateway routes each final phrase into speaker A or B lane.
  useEffect(() => {
    const gw = gateway.current;
    if (!gw) return;

    const h = startTranscription({
      onInterim: (text) => setCaption(text),
      onFinal: (text) => {
        if (!text) return;
        setCaption("");
        const line = gw.routeFinal(text);
        setFeed((prev) => [...prev.slice(-60), line]);
      },
      onStatus: (status, detail) => {
        setSttStatus(status);
        setSttDetail(detail ?? "");
      },
      onError: () => {},
    });
    stt.current = h;
    return () => {
      h.stop();
      stt.current = null;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // keep the transcript feed scrolled to the newest line
  useEffect(() => {
    feedEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [feed, caption]);

  // Layer 1 — score each speaker lane independently.
  useEffect(() => {
    const gw = gateway.current;
    if (!gw) return;
    const id = setInterval(() => {
      if (ended.current) return;
      setLanes((prev) =>
        prev.map((lane, i) => {
          const text = gw.windowText(i as 0 | 1, WINDOW_MS);
          const l1 = scoreL1(text);
          const blended =
            lane.l2 != null ? Math.round(l1.score * 0.45 + lane.l2 * 0.55) : l1.score;
          // Ratchet: once you LARP, you LARP. The score only ever eases UP toward
          // the highest reading seen — it never decays back down.
          const peak = Math.max(lane.score, blended);
          const next = lane.score + (peak - lane.score) * 0.3;
          const tags = mergeTags(l1.tags, lane.tags);
          return { ...lane, score: next, tags, words: l1.words };
        }),
      );
    }, 400);
    return () => clearInterval(id);
  }, []);

  // Layer 2 — Cursor SDK judge per lane.
  useEffect(() => {
    const gw = gateway.current;
    if (!gw) return;
    let alive = true;
    const ac = new AbortController();
    const gate = gw;

    async function tick(i: 0 | 1) {
      while (alive) {
        await sleep(L2_INTERVAL_MS);
        if (!alive || ended.current) break;
        const text = gate.windowText(i, WINDOW_MS);
        if (text.split(/\s+/).filter(Boolean).length < 6) continue;
        const out = await callJudge(i === 0 ? names[0] : names[1], text, ac.signal);
        if (!alive || !out) continue;
        setJudgeOn(true);
        setLanes((prev) =>
          prev.map((lane, j) =>
            j === i
              ? { ...lane, l2: out.score, tags: mergeTags(out.buzzwords, lane.tags) }
              : lane,
          ),
        );
      }
    }

    tick(0);
    tick(1);
    return () => {
      alive = false;
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStop() {
    ended.current = true;
    stt.current?.stop();
    const rec = recorder.current ? await recorder.current.stop() : null;
    const log = gateway.current?.getLog() ?? [];
    setSummary({
      lines: log.map((l) => ({
        t: l.t,
        speaker: l.speaker,
        name: l.name,
        text: l.text,
      })),
      rec,
      scores: [Math.round(lanes[0].score), Math.round(lanes[1].score)],
    });
  }

  if (summary) {
    return (
      <Summary
        lines={summary.lines}
        rec={summary.rec}
        names={[lanes[0].name, lanes[1].name]}
        scores={summary.scores}
        onDone={onStop}
      />
    );
  }

  const leader =
    lanes[0].score === lanes[1].score ? null : lanes[0].score > lanes[1].score ? 0 : 1;
  const live = sttStatus === "listening" || sttStatus === "restarting";
  const loadingStt = sttStatus === "loading";

  return (
    <div className="dash">
      {/* ---------- top bar ---------- */}
      <header className="dash-top">
        <div className="dash-brand">
          <span className="rec-dot" />
          <span className="dash-brand-name">Stop&nbsp;Larping</span>
          <span className="dash-clock">{fmt(elapsed)}</span>
        </div>

        <DetectBar detect={detect} names={names} />

        <div className="dash-top-right">
          <SttChip status={sttStatus} detail={sttDetail} />
          <button className="btn-stop" onClick={handleStop}>
            End&nbsp;session
          </button>
        </div>
      </header>

      {/* ---------- two speakers ---------- */}
      <div className="dash-main">
        {lanes.map((lane, i) => {
          const speaking = detect.active === i;
          return (
            <section
              className={`sp${speaking ? " sp-speaking" : ""}${leader === i ? " sp-leader" : ""}`}
              key={i}
              style={{ "--sp": lane.color } as CSSProperties}
            >
              <div className="sp-head">
                <div className="sp-id">
                  <span className="sp-name">{lane.name}</span>
                  <span className="sp-sub">{subtitles[i]}</span>
                </div>
                <span className={`sp-live${speaking ? " on" : ""}`}>
                  {speaking ? "Speaking" : ""}
                </span>
              </div>

              <Gauge score={lane.score} />
              <div className="sp-verdict">{verdict(lane.score)}</div>

              <Waveform
                analyser={analyser.current}
                color={lane.color}
                muted={!speaking}
              />

              <div className="sp-tags">
                {lane.tags.length === 0 ? (
                  <span className="tag tag-clean">no tells yet</span>
                ) : (
                  lane.tags.map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))
                )}
              </div>

              <div className="sp-foot">
                <span className="sp-foot-k">Words</span>
                <span className="sp-foot-v">{lane.words}</span>
                {leader === i && lane.score > 0 && (
                  <span className="sp-foot-lead">Bigger LARP</span>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* ---------- transcript feed ---------- */}
      <section className="feed">
        <div className="feed-scroll">
          {feed.length === 0 && !caption ? (
            <div className="feed-empty">
              {loadingStt
                ? "Preparing on-device transcription (one-time ~100MB download)…"
                : live
                  ? "Listening… start talking and lines will appear here, tagged by speaker."
                  : "Transcription unavailable — check the status pill above."}
            </div>
          ) : (
            feed.map((l, i) => (
              <div className={`feed-line feed-${l.speaker}`} key={i}>
                <span className="feed-name">{l.name}</span>
                <span className="feed-text">{l.text}</span>
              </div>
            ))
          )}
          {caption && (
            <div className="feed-line feed-interim">
              <span className="feed-name">…</span>
              <span className="feed-text">{caption}</span>
            </div>
          )}
          <div ref={feedEnd} />
        </div>
        <div className="feed-foot">
          <span>{judgeOn ? "due diligence: live" : "vibe check only"}</span>
          <span>{feed.length} lines</span>
        </div>
      </section>
    </div>
  );
}

/** Top-center "who is speaking" + confidence indicator. */
function DetectBar({ detect, names }: { detect: Detect; names: [string, string] }) {
  const a = detect.active;
  const label = a === null ? "Listening" : `${names[a]} speaking`;
  const p1 = Math.max(0, Math.min(1, detect.presence[0]));
  const p2 = Math.max(0, Math.min(1, detect.presence[1]));
  return (
    <div className={`detect${a !== null ? " detect-on" : ""}`}>
      <span
        className="detect-dot"
        style={{
          background: a === null ? "var(--fg-dim)" : a === 0 ? "var(--p1)" : "var(--p2)",
        }}
      />
      <span className="detect-label">{label}</span>
      <div className="detect-meter">
        <div
          className="detect-meter-fill detect-p1"
          style={{ width: `${p1 * 50}%` }}
        />
        <div
          className="detect-meter-fill detect-p2"
          style={{ width: `${p2 * 50}%` }}
        />
      </div>
      {a !== null && (
        <span className="detect-conf">{Math.round(detect.conf * 100)}%</span>
      )}
    </div>
  );
}

function SttChip({ status, detail }: { status: SttStatus; detail: string }) {
  const label =
    status === "listening"
      ? "Hearing you"
      : status === "loading"
        ? `Loading transcriber ${detail && detail !== "fallback" ? detail : ""}`.trim()
        : status === "restarting"
          ? "Reconnecting"
          : status === "error"
            ? detail || "transcription error"
            : "off";
  return <span className={`stt-chip stt-${status}`}>{label}</span>;
}

function mergeTags(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...a, ...b]) {
    const k = t.toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= 4) break;
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
