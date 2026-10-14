import type { LlmTokenUsage } from '@/types/invoice';

// Claude Sonnet 4 pricing (USD per token)
const INPUT_COST_PER_TOKEN = 3 / 1_000_000;   // $3 per million input tokens
const OUTPUT_COST_PER_TOKEN = 15 / 1_000_000;  // $15 per million output tokens

export function calculateLlmCost(
  inputTokens: number,
  outputTokens: number
): LlmTokenUsage {
  const costUsd =
    inputTokens * INPUT_COST_PER_TOKEN +
    outputTokens * OUTPUT_COST_PER_TOKEN;

  return { inputTokens, outputTokens, costUsd };
}

export function sumLlmUsage(usages: LlmTokenUsage[]): LlmTokenUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  for (const u of usages) {
    inputTokens += u.inputTokens;
    outputTokens += u.outputTokens;
    costUsd += u.costUsd;
  }
  return { inputTokens, outputTokens, costUsd };
}

export const ZERO_USAGE: LlmTokenUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
