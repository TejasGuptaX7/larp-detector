import express from "express";
import cors from "cors";
import { analyze, judge } from "./judge.ts";
import { PostHog } from "posthog-node";

const PORT = Number(process.env.PORT ?? 8787);

const posthog = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST ?? "https://us.i.posthog.com",
  enableExceptionAutocapture: true,
});

function phDistinctId(req: express.Request): string {
  return (req.headers["x-posthog-distinct-id"] as string) ?? "server";
}

function phSessionId(req: express.Request): string | undefined {
  return req.headers["x-posthog-session-id"] as string | undefined;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));

app.get("/", (_req, res) => {
  res.type("text/plain").send(
    [
      "LARP judge — Cursor SDK",
      "",
      "status:  running",
      `model:   ${process.env.LARP_MODEL ?? "auto"}`,
      "",
      "GET  /api/health   liveness probe",
      "POST /api/judge    { speaker, transcript } -> { score, buzzwords, reason }",
      "POST /api/analyze  { lines: [{name,text}] } -> full-conversation verdict",
    ].join("\n"),
  );
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, sdk: "@cursor/sdk", model: process.env.LARP_MODEL ?? "auto" });
});

/**
 * Mint a short-lived AssemblyAI streaming token so the browser can open the
 * realtime WebSocket directly — the long-lived API key never leaves the server.
 * Returns 501 if no key is set, so the client falls back to in-browser STT.
 */
app.get("/api/aai-token", async (req, res) => {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) return res.status(501).json({ error: "assemblyai_not_configured" });
  try {
    const r = await fetch(
      "https://streaming.assemblyai.com/v3/token?expires_in_seconds=300",
      { headers: { Authorization: key } },
    );
    if (!r.ok) {
      return res.status(502).json({ error: "token_failed", status: r.status });
    }
    const data = (await r.json()) as { token?: string };
    if (!data.token) return res.status(502).json({ error: "no_token" });
    posthog.capture({
      distinctId: phDistinctId(req),
      event: "aai_token_issued",
      properties: { $session_id: phSessionId(req) },
    });
    res.json({ token: data.token });
  } catch (err) {
    res.status(500).json({
      error: "token_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/analyze", async (req, res) => {
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
  const clean = lines
    .map((l: Record<string, unknown>) => ({
      name: String(l?.name ?? "?").slice(0, 24),
      text: String(l?.text ?? "").slice(0, 500),
    }))
    .filter((l: { text: string }) => l.text.trim())
    .slice(-200);

  if (clean.length === 0) {
    return res.json({ headline: "Nothing was said.", speakers: [] });
  }
  const distinctId = phDistinctId(req);
  const sessionId = phSessionId(req);
  try {
    const out = await analyze(clean);
    posthog.capture({
      distinctId,
      event: "analyze_called",
      properties: { line_count: clean.length, $session_id: sessionId },
    });
    res.json(out);
  } catch (err) {
    console.error("analyze failed:", err);
    posthog.capture({
      distinctId,
      event: "analyze_failed",
      properties: {
        error_message: err instanceof Error ? err.message : String(err),
        $session_id: sessionId,
      },
    });
    res.status(500).json({
      error: "analyze_failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/judge", async (req, res) => {
  const speaker = String(req.body?.speaker ?? "Speaker");
  const transcript = String(req.body?.transcript ?? "");
  if (!transcript.trim()) {
    return res.json({ score: 0, buzzwords: [], reason: "empty" });
  }
  const distinctId = phDistinctId(req);
  const sessionId = phSessionId(req);
  try {
    const out = await judge(speaker, transcript);
    posthog.capture({
      distinctId,
      event: "judge_called",
      properties: {
        score: out.score,
        buzzword_count: out.buzzwords.length,
        word_count: transcript.split(/\s+/).filter(Boolean).length,
        $session_id: sessionId,
      },
    });
    res.json(out);
  } catch (err) {
    console.error("judge failed:", err);
    posthog.capture({
      distinctId,
      event: "judge_failed",
      properties: {
        error_message: err instanceof Error ? err.message : String(err),
        $session_id: sessionId,
      },
    });
    res.status(500).json({
      error: "judge_failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

const server = app.listen(PORT, () => {
  console.log(`LARP judge (Cursor SDK) listening on http://localhost:${PORT}`);
});

process.on("SIGTERM", async () => {
  server.close();
  await posthog.shutdown();
});
process.on("SIGINT", async () => {
  server.close();
  await posthog.shutdown();
});
