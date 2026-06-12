import { Agent } from "@cursor/sdk";
import {
  buildAnalysisPrompt,
  buildJudgePrompt,
  parseAnalysis,
  parseJudge,
  type AnalysisResult,
  type JudgeResult,
} from "./rubric.ts";

const MODEL_ID = process.env.LARP_MODEL ?? "auto";

function requireKey(): string {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) throw new Error("CURSOR_API_KEY is not set");
  return apiKey;
}

/**
 * Layer 2 of the LARP engine: ask the Cursor agent (via @cursor/sdk) to grade a
 * transcript segment. One-shot local run, strict-JSON output, parsed defensively.
 */
export async function judge(
  speaker: string,
  transcript: string,
): Promise<JudgeResult> {
  const result = await Agent.prompt(buildJudgePrompt(speaker, transcript), {
    apiKey: requireKey(),
    model: { id: MODEL_ID },
    local: { cwd: process.cwd() },
  });

  return parseJudge(result.result ?? "");
}

/**
 * Post-session: the Cursor agent reads the WHOLE labeled conversation and
 * delivers the final per-speaker verdicts + headline.
 */
export async function analyze(
  lines: { name: string; text: string }[],
): Promise<AnalysisResult> {
  const result = await Agent.prompt(buildAnalysisPrompt(lines), {
    apiKey: requireKey(),
    model: { id: MODEL_ID },
    local: { cwd: process.cwd() },
  });

  return parseAnalysis(result.result ?? "");
}
