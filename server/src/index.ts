import express from "express";
import cors from "cors";
import { analyze, judge } from "./judge.ts";

const PORT = Number(process.env.PORT ?? 8787);

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
app.get("/api/aai-token", async (_req, res) => {
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
  try {
    const out = await analyze(clean);
    res.json(out);
  } catch (err) {
    console.error("analyze failed:", err);
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
  try {
    const out = await judge(speaker, transcript);
    res.json(out);
  } catch (err) {
    console.error("judge failed:", err);
    res.status(500).json({
      error: "judge_failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

app.listen(PORT, () => {
  console.log(`LARP judge (Cursor SDK) listening on http://localhost:${PORT}`);
});
