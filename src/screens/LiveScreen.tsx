import { useEffect, useRef, useState } from "react";
import { Waveform } from "../components/Waveform";
import { Gauge } from "../components/Gauge";
import { verdict } from "../lib/score";
import { scoreL1 } from "../lib/larp";
import { startStt, sttSupported, type SttHandle, type SttStatus } from "../lib/stt";
import { callJudge } from "../lib/judgeClient";
import { getEngine, getMic, getProfiles, getStream } from "../lib/session";
import { SpeakerGateway } from "../lib/gateway";
import type { VoiceEngine } from "../lib/voice";
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
  lastLine: string;
  l2: number | null;
};

const WINDOW_MS = 30_000;
const L2_INTERVAL_MS = 12_000;
const FRAME_MS = 60;

export function LiveScreen({ onStop }: Props) {
  const profiles = getProfiles();
  const names: [string, string] = [
    profiles[0]?.name || "A",
    profiles[1]?.name || "B",
  ];

  const [lanes, setLanes] = useState<Lane[]>(() => [
    { name: names[0], color: "var(--low)", score: 0, tags: [], words: 0, lastLine: "", l2: null },
    { name: names[1], color: "var(--high)", score: 0, tags: [], words: 0, lastLine: "", l2: null },
  ]);
  const [elapsed, setElapsed] = useState(0);
  const [sttStatus, setSttStatus] = useState<SttStatus>("off");
  const [sttDetail, setSttDetail] = useState("");
  const [judgeOn, setJudgeOn] = useState(false);
  const [caption, setCaption] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const [summary, setSummary] = useState<{
    lines: Line[];
    rec: Recording | null;
    scores: [number, number];
  } | null>(null);

  const analyser = useRef<AnalyserNode | null>(getMic()?.analyser ?? null);
  const engine = useRef<VoiceEngine | null>(getEngine());
  const stt = useRef<SttHandle | null>(null);
  const recorder = useRef<ConvoRecorder | null>(null);
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
      const who = gw.tick(e.frame());
      setActive(who);
    }, FRAME_MS);
    return () => clearInterval(id);
  }, []);

  // STT -> gateway routes each final phrase into speaker A or B lane.
  useEffect(() => {
    if (!sttSupported()) {
      setSttStatus("error");
      setSttDetail("use Chrome");
      return;
    }
    const gw = gateway.current;
    if (!gw) return;

    const h = startStt({
      onInterim: (text) => setCaption(text),
      onFinal: (text) => {
        if (!text) return;
        setCaption("");
        const line = gw.routeFinal(text);
        setLanes((prev) =>
          prev.map((l, i) =>
            i === line.speaker ? { ...l, lastLine: line.text } : l,
          ),
        );
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

  // Layer 1 — score each speaker lane independently.
  useEffect(() => {
    const gw = gateway.current;
    if (!gw) return;
    const id = setInterval(() => {
      setLanes((prev) =>
        prev.map((lane, i) => {
          const text = gw.windowText(i as 0 | 1, WINDOW_MS);
          const l1 = scoreL1(text);
          const blended =
            lane.l2 != null ? Math.round(l1.score * 0.45 + lane.l2 * 0.55) : l1.score;
          const next = lane.score + (blended - lane.score) * 0.25;
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
        if (!alive) break;
        const text = gate.windowText(i, WINDOW_MS);
        if (text.split(/\s+/).filter(Boolean).length < 6) continue;
        const out = await callJudge(i === 0 ? "A" : "B", text, ac.signal);
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
  }, []);

  async function handleStop() {
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

  const sttChip =
    sttStatus === "listening"
      ? "HEARING"
      : sttStatus === "restarting"
        ? "RECONNECTING"
        : sttStatus === "error"
          ? `STT ${sttDetail || "ERROR"}`
          : "STT OFF";

  return (
    <div className="live">
      <div className="live-top">
        <div className="rec">
          <span className="rec-dot" />
          <span>LIVE</span>
        </div>
        <div className={`stt-chip stt-${sttStatus}`}>{sttChip}</div>
        <div className="clock">{fmt(elapsed)}</div>
        <button className="btn-stop" onClick={handleStop}>
          STOP
        </button>
      </div>

      <div className={`caption${caption ? " caption-on" : ""}`}>
        {caption || "listening for speech…"}
      </div>

      <div className="arena">
        {lanes.map((lane, i) => (
          <div
            className={`lane${leader === i ? " lane-lead" : ""}${active === i ? " lane-live" : ""}`}
            key={i}
          >
            <div className="lane-head">
              <div className="lane-name">{lane.name}</div>
              <div className={`lane-tag${active === i ? " on" : ""}`}>
                {active === i ? "SPEAKING" : ""}
              </div>
            </div>
            <Gauge score={lane.score} />
            <div className="verdict">{verdict(lane.score)}</div>
            <Waveform analyser={analyser.current} color={lane.color} muted={active !== i} />
            <div className="line">{lane.lastLine || "…"}</div>
            <div className="tags">
              {lane.tags.length === 0 ? (
                <span className="tag tag-empty">clean</span>
              ) : (
                lane.tags.map((t) => (
                  <span className="tag" key={t}>
                    {t}
                  </span>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="live-foot">
        <div className="stat">
          <span className="stat-k">WORDS {lanes[0].name}</span>
          <span className="stat-v">{lanes[0].words}</span>
        </div>
        <div className="stat">
          <span className="stat-k">GATEWAY</span>
          <span className="stat-v">
            {sttStatus === "listening" || sttStatus === "restarting" ? "VOICE→2" : "OFF"}
            {judgeOn ? "+AI" : ""}
          </span>
        </div>
        <div className="stat">
          <span className="stat-k">WORDS {lanes[1].name}</span>
          <span className="stat-v">{lanes[1].words}</span>
        </div>
      </div>
    </div>
  );
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
