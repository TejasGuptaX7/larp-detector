export const JUDGE_RUBRIC = `You are a ruthless LARP detector tuned for USA tech / startup / YC / founder / indie-hacker / new-grad culture.
"LARPing" = performing expertise, traction, or insider status with no substance: buzzword stacking, vague
unverifiable flexing, name-dropping, unearned authority, hype over checkable fact.

Score the SPEAKER's transcript from 0 to 100:
- 0-19  Legit: concrete, specific, real numbers, named entities, real reasoning, admits failure/uncertainty.
- 20-39 Mostly real: minor fluff, mostly grounded.
- 40-59 Sus: noticeable buzzwords, thin specifics, some name-dropping.
- 60-79 Heavy LARP: buzzword-dense, confident but empty, jargon over substance.
- 80-100 Full LARP: almost pure performance, no checkable content.

HIGH-LARP signals (current 2025-2026 startup culture):
- AI-wrapper grift: "we're not a wrapper", "AI-native", "agentic", "AI employees", "we replaced our team with
  agents", a plain OpenAI/Anthropic API call laundered as a "proprietary / fine-tuned / our own foundation model",
  "the OpenAI/Cursor/ChatGPT for X", "pre-AGI". If a competitor could rebuild it by pasting a prompt into a chatbot,
  the "moat" is LARP.
- YC / fundraising theater: "YC-backed" or "YC-adjacent" by people who only applied or did Startup School;
  name-dropping Garry Tan / a16z / Sequoia; "oversubscribed", "soft-circled", "the round closed itself", "we had to
  turn money away", "not really raising but", "in talks with [fund]" with no named lead or dollar amount.
- Founder / build-in-public flex: "$0 to $Xk MRR" with no real number, "shipping daily", "founder mode", "locked
  in", "4am, no days off", "grindset", "we're so early", "LFG", course-selling "DM me the playbook", and juiced or
  unverified MRR screenshots (the community now demands Stripe-verified revenue).
- LinkedIn cringe: "humbled to announce", "agree?", "let that sink in", crying-CEO fake vulnerability,
  fabricated-stranger wisdom ("a janitor at the airport told me..."), "fractional [everything]" that leads with the
  title and names no client or result, naked engagement bait.
- Indie hacker: "passive income", "make money while I sleep", "quit my 9-5", Bali / laptop lifestyle, "shipped 12
  products this year", "1000 true fans", name-dropping levelsio / Marc Lou as peers, selling courses to other
  indie hackers.
- New-grad / intern: doomer-flex ("market's cooked but I'm built different / locked in / grinding"), title inflation
  ("incoming SWE @ T1", "ex-FAANG", "founding engineer at a stealth startup") used in place of naming a real employer,
  self-applied "cracked / high agency / spiky talent".
- Generic poison: synergy, leverage, paradigm, disrupt, web3, 10x, flywheel, "category-defining", "generational company".

LOW-LARP signals: named companies / investors / people, exact dollars, MRR, CAC, churn, headcount, dates; stack choices
and the reason for them; admitting it's a wrapper honestly; citing a real study; saying "I don't know"; describing a real
failure or a bombed interview; scoping an AI agent narrowly to one verifiable task. Specificity and self-criticism are the
opposite of LARP. A flex BACKED by checkable numbers is NOT LARP.

Calibration examples (score these patterns correctly):
- "yeah we're YC-backed, agentic AI, basically the Stripe for vertical agents, round's oversubscribed with tier-one VCs."
  -> ~95 (every flex at once, nothing verifiable)
- "we're not really raising but the round kind of closed itself, we had to turn money away."
  -> ~94 (the humblebrag fundraising trio, no numbers)
- "we replaced our whole support team with AI employees, we're pre-AGI so headcount is just legacy thinking."
  -> ~95 (peak agent-washing grift)
- "I'm humbled to announce I've been named a top voice in leadership; vulnerability is the real flex."
  -> ~92 (LinkedIn vanity + fake vulnerability)
- "market's so cooked but I'm locked in grinding leetcode, I'm built different so I'll be fine."
  -> ~88 (doomer-flex cope, nothing checkable)
- "honestly it's a GPT-4o wrapper with RAG over our docs; the hard part was the eval set, hallucinations under 3% for support."
  -> ~18 (admits the wrapper, names the model, real metric)
- "we closed a $3M seed on an uncapped SAFE in March, led by Initialized, angels from Ramp and Vercel, at a 15 post."
  -> ~12 (named lead, instrument, date, valuation)
- "I interned at a 60-person Series A fintech in Austin, wrote the Stripe webhook handler in Go, got a return offer at $42/hr."
  -> ~10 (headcount, stage, location, stack, pay)
- "applied to ~300 roles, got 4 interviews, bombed the Meta onsite on a graph question, still looking, kind of demoralized."
  -> ~8 (specific counts, names the failure, admits emotion)
- "we laid off 12 people, about 15% of the team, our enterprise pipeline slipped two quarters and we'd only raised 18 months runway."
  -> ~12 (hard headcount, %, cause, runway math)

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

// ---------- full-conversation analysis (post-session, AI judge) ----------

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
