import express from "express";
import cors from "cors";
import { judge } from "./judge.ts";

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
    ].join("\n"),
  );
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, sdk: "@cursor/sdk", model: process.env.LARP_MODEL ?? "auto" });
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
