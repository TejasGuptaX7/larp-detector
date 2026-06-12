import { useEffect, useState } from "react";
import { verdict } from "../lib/score";
import { callAnalyze, type Analysis } from "../lib/judgeClient";
import type { Recording } from "../lib/recorder";
import { usePostHog } from "@posthog/react";

export type Line = { t: number; speaker: number; name: string; text: string };

type Props = {
  lines: Line[];
  rec: Recording | null;
  names: [string, string];
  scores: [number, number];
  onDone: () => void;
};

export function Summary({ lines, rec, names, scores, onDone }: Props) {
  const winner = scores[0] === scores[1] ? -1 : scores[0] > scores[1] ? 0 : 1;
  const colors = ["var(--p1)", "var(--p2)"];
  const posthog = usePostHog();

  const [ai, setAi] = useState<Analysis | null>(null);
  const [aiState, setAiState] = useState<"loading" | "done" | "off">(
    lines.length ? "loading" : "off",
  );

  // Cursor SDK agent reads the whole labeled conversation and rules on it.
  useEffect(() => {
    if (!lines.length) return;
    const ac = new AbortController();
    (async () => {
      const out = await callAnalyze(
        lines.map((l) => ({ name: l.name, text: l.text })),
        ac.signal,
      );
      if (ac.signal.aborted) return;
      setAi(out);
      setAiState(out ? "done" : "off");
    })();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function downloadTranscript() {
    posthog?.capture("transcript_downloaded", { line_count: lines.length });
    const body = lines
      .map((l) => `[${stamp(l.t, lines[0]?.t ?? l.t)}] ${l.name}: ${l.text}`)
      .join("\n");
    const blob = new Blob([body], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "larp-transcript.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleNewSession() {
    posthog?.capture("new_session_started");
    onDone();
  }

  return (
    <div className="summary">
      <div className="summary-top">
        <div className="summary-mark">SESSION REPORT</div>
        <button className="btn-stop" onClick={handleNewSession}>
          NEW
        </button>
      </div>

      <div className="summary-scores">
        {[0, 1].map((i) => (
          <div className={`summary-score${winner === i ? " win" : ""}`} key={i}>
            <div className="summary-name" style={{ color: colors[i] }}>
              {names[i]}
            </div>
            <div className="num summary-num">{scores[i]}%</div>
            <div className="verdict">{verdict(scores[i])}</div>
          </div>
        ))}
      </div>

      <div className="summary-call">
        {winner === -1 ? "Dead heat." : `${names[winner]} was the bigger LARPer.`}
      </div>

      {aiState !== "off" && (
        <div className="summary-ai">
          <div className="summary-ai-head">
            <span>Due Diligence</span>
            {aiState === "loading" && (
              <span className="summary-ai-wait">running diligence…</span>
            )}
          </div>
          {aiState === "done" && ai && (
            <>
              <div className="summary-ai-headline">{ai.headline}</div>
              <div className="summary-ai-grid">
                {ai.speakers.map((s, i) => (
                  <div className="summary-ai-card" key={i}>
                    <div className="summary-ai-name">
                      <span>{s.name}</span>
                      <span className="num">{s.score}%</span>
                    </div>
                    <div className="summary-ai-verdict">{s.verdict}</div>
                    {s.worstLine && (
                      <div className="summary-ai-line">“{s.worstLine}”</div>
                    )}
                    {s.buzzwords.length > 0 && (
                      <div className="tags">
                        {s.buzzwords.map((b) => (
                          <span className="tag" key={b}>
                            {b}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {rec && (
        <div className="summary-audio">
          <audio src={rec.url} controls className="summary-player" />
          <a
            className="summary-dl"
            href={rec.url}
            download="larp-conversation.webm"
            onClick={() => posthog?.capture("audio_downloaded")}
          >
            Download audio
          </a>
        </div>
      )}

      <div className="summary-tx-head">
        <span>TRANSCRIPT</span>
        <button className="summary-dl-tx" onClick={downloadTranscript}>
          Download .txt
        </button>
      </div>

      <div className="summary-tx">
        {lines.length === 0 ? (
          <div className="summary-empty">
            No speech captured. Speech-to-text needs Chrome with network access —
            check the STT chip during the session.
          </div>
        ) : (
          lines.map((l, i) => (
            <div className={`tx-line tx-${l.speaker}`} key={i}>
              <span className="tx-name" style={{ color: colors[l.speaker] }}>
                {l.name}
              </span>
              <span className="tx-text">{l.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function stamp(t: number, t0: number): string {
  const s = Math.max(0, Math.round((t - t0) / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
