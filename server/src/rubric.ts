export const JUDGE_RUBRIC = `You are a strict LARP detector tuned for USA tech, startup, YC, and internship culture.
"LARPing" = performing expertise or insider status with no substance: LinkedIn-post
energy, founder-twitter flexing, buzzword stacking, vague traction claims, unbacked
authority, name-dropping without detail.

Score the SPEAKER's transcript from 0 to 100:
- 0-19  Legit: concrete, specific, backed by detail, numbers, real reasoning.
- 20-39 Mostly real: minor fluff, mostly grounded.
- 40-59 Sus: noticeable buzzwords, some vagueness, thin specifics.
- 60-79 Heavy LARP: buzzword-dense, confident but empty, jargon over substance.
- 80-100 Full LARP: almost pure performance, no real content.

HIGH LARP signals in this domain:
- YC/stealth/seed theater: "quietly closed", "can't share the number", "stealth mode",
  "building in public soon", "term sheet", "default alive"
- Intern/new-grad performance: "cracked engineer", "10x engineer", "coffee chat",
  vague "return offer" with no company or role detail
- LinkedIn-core: "humbled to announce", "integrity > income", "what happened next",
  "agree?", "mentor to millions", "thought leader", fake humble brags
- Twitter/indie: "$0 to $X MRR", "no product, just vibes", "replaced my team with AI
  agents", "on a beach in Bali", "can't say who" dinner name-drops
- Generic poison: synergy, leverage, paradigm, ecosystem, disrupt, web3, AI-native,
  agentic, 10x, flywheel, moat, game-changer

LOW LARP signals:
- Specific company names, dates, dollar amounts, headcount, stack choices, tradeoffs
- Admitting uncertainty, saying "I don't know", describing a real failure
- Step-by-step reasoning, cause-and-effect, checkable facts

Calibration examples (score these patterns correctly):
- "I'm interning at Stripe on the payments team, shipping a fraud dashboard by August."
  -> ~10 (specific)
- "I quietly closed our seed at a number I can't share. Back to work."
  -> ~88 (classic flex LARP)
- "We're leveraging an AI-native paradigm to disrupt the web3 ecosystem at scale."
  -> ~95 (pure buzzwords)
- "My YC batchmate said PMF is about retention, so we're watching week-4 cohort churn."
  -> ~25 (jargon but substantive)

Return ONLY minified JSON, no prose, no code fences:
{"score": <int 0-100>, "buzzwords": [<up to 5 lowercase strings>], "reason": "<<=12 words>"}`;

export function buildJudgePrompt(speaker: string, transcript: string): string {
  const clean = transcript.trim().slice(-1800);
  return `${JUDGE_RUBRIC}

SPEAKER: ${speaker}
TRANSCRIPT:
"""
${clean || "(no speech yet)"}
"""

JSON:`;
}

export type JudgeResult = {
  score: number;
  buzzwords: string[];
  reason: string;
};

// ---------- full-conversation analysis (post-session, Cursor SDK) ----------

export type AnalysisSpeaker = {
  name: string;
  score: number;
  verdict: string;
  buzzwords: string[];
  worstLine: string;
};

export type AnalysisResult = {
  headline: string;
  speakers: AnalysisSpeaker[];
};

export function buildAnalysisPrompt(
  lines: { name: string; text: string }[],
): string {
  const convo = lines
    .map((l) => `${l.name}: ${l.text}`)
    .join("\n")
    .slice(-6000);

  return `${JUDGE_RUBRIC}

You are now grading a FULL recorded conversation between two people. Each line
is labeled with the speaker's name. Judge each speaker INDEPENDENTLY on their
own lines only.

CONVERSATION:
"""
${convo || "(empty)"}
"""

Return ONLY minified JSON, no prose, no code fences:
{"headline":"<<=14 words, punchy verdict on the whole convo>","speakers":[{"name":"<speaker name>","score":<int 0-100>,"verdict":"<<=12 words>","buzzwords":[<up to 5 lowercase strings>],"worstLine":"<their single most LARP line, verbatim or close>"}]}

JSON:`;
}

export function parseAnalysis(raw: string): AnalysisResult {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { headline: "no output", speakers: [] };
  try {
    const obj = JSON.parse(match[0]);
    const speakers = Array.isArray(obj.speakers)
      ? obj.speakers.slice(0, 2).map((s: Record<string, unknown>) => ({
          name: String(s.name ?? "?").slice(0, 24),
          score: Math.max(0, Math.min(100, Math.round(Number(s.score) || 0))),
          verdict: String(s.verdict ?? "").slice(0, 90),
          buzzwords: Array.isArray(s.buzzwords)
            ? s.buzzwords.slice(0, 5).map((b: unknown) => String(b))
            : [],
          worstLine: String(s.worstLine ?? "").slice(0, 200),
        }))
      : [];
    return {
      headline: String(obj.headline ?? "").slice(0, 120),
      speakers,
    };
  } catch {
    return { headline: "parse error", speakers: [] };
  }
}

export function parseJudge(raw: string): JudgeResult {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { score: 0, buzzwords: [], reason: "no output" };
  try {
    const obj = JSON.parse(match[0]);
    const score = Math.max(0, Math.min(100, Math.round(Number(obj.score) || 0)));
    const buzzwords = Array.isArray(obj.buzzwords)
      ? obj.buzzwords.slice(0, 5).map((s: unknown) => String(s))
      : [];
    const reason = typeof obj.reason === "string" ? obj.reason.slice(0, 80) : "";
    return { score, buzzwords, reason };
  } catch {
    return { score: 0, buzzwords: [], reason: "parse error" };
  }
}
