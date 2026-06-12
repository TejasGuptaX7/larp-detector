import { Agent } from "@cursor/sdk";
import { buildJudgePrompt, parseJudge, type JudgeResult } from "./rubric.ts";

const MODEL_ID = process.env.LARP_MODEL ?? "auto";

/**
 * Layer 2 of the LARP engine: ask the Cursor agent (via @cursor/sdk) to grade a
 * transcript segment. One-shot local run, strict-JSON output, parsed defensively.
 */
export async function judge(
  speaker: string,
  transcript: string,
): Promise<JudgeResult> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) throw new Error("CURSOR_API_KEY is not set");

  const result = await Agent.prompt(buildJudgePrompt(speaker, transcript), {
    apiKey,
    model: { id: MODEL_ID },
    local: { cwd: process.cwd() },
  });

  return parseJudge(result.result ?? "");
}
