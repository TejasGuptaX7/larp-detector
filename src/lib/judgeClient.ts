// Client for the Layer 2 judge (Cursor SDK, Agent.prompt) running in /server.
// Best-effort: if the server is down, callers fall back to Layer 1 only.

const BASE = import.meta.env.VITE_JUDGE_URL ?? "http://localhost:8787";

export type JudgeResult = {
  score: number;
  buzzwords: string[];
  reason: string;
};

export async function callJudge(
  speaker: string,
  transcript: string,
  signal?: AbortSignal,
): Promise<JudgeResult | null> {
  try {
    const res = await fetch(`${BASE}/api/judge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ speaker, transcript }),
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<JudgeResult>;
    if (typeof data.score !== "number") return null;
    return {
      score: data.score,
      buzzwords: Array.isArray(data.buzzwords) ? data.buzzwords : [],
      reason: typeof data.reason === "string" ? data.reason : "",
    };
  } catch {
    return null;
  }
}

export async function judgeHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}
