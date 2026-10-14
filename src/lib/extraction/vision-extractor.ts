/**
 * Vision-based extraction using Claude API for scanned/image-based PDFs.
 * Two-step flow: (1) reasoning over the document, (2) JSON-only from reasoning.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ExtractedInvoiceData, LlmTokenUsage } from '@/types/invoice';
import {
  buildVisionJsonFromReasoningPrompt,
  buildVisionReasoningPrompt,
  parseInvoiceJsonFromLlmResponse,
} from './invoice-llm-extraction';
import { calculateLlmCost, sumLlmUsage } from './llm-cost';
import {
  AnthropicModelAccessError,
  getExtractionModel,
  isAnthropicModelNotFound,
} from './anthropic-models';

/** Room for step-by-step OCR reasoning (handwriting, VAT checks). */
const VISION_REASONING_MAX_TOKENS = 4096;
/** JSON object + short rationale bleed — single structured reply. */
const VISION_JSON_MAX_TOKENS = 2048;

function collectAssistantText(
  response: Anthropic.Messages.Message,
): string {
  const parts: string[] = [];
  for (const block of response.content) {
    if (block.type === 'text') parts.push(block.text);
  }
  return parts.join('\n').trim();
}

export interface VisionExtractionResult {
  data: ExtractedInvoiceData;
  usage: LlmTokenUsage;
}

async function createVisionMessage(params: {
  client: Anthropic;
  model: string;
  max_tokens: number;
  content: Anthropic.Messages.MessageCreateParams['messages'][0]['content'];
  apiKeyOverride?: string;
}): Promise<Anthropic.Messages.Message> {
  const { client, model, max_tokens, content } = params;
  try {
    return await client.messages.create({
      model,
      max_tokens,
      temperature: 0,
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    if (isAnthropicModelNotFound(err)) {
      throw new AnthropicModelAccessError(
        model,
        params.apiKeyOverride ? 'user' : 'platform',
        err
      );
    }
    throw err;
  }
}

export async function extractWithVision(
  pdfBuffer: Buffer,
  /**
   * Merged global + matched-vendor extraction notes (same string as the text LLM path).
   */
  vendorInstructions: string | undefined,
  /**
   * Per-user (BYOK) Anthropic key. When provided, it overrides the shared
   * platform key for this single call so BYOK users pay Anthropic directly.
   */
  apiKeyOverride?: string,
  /**
   * Names belonging to the account owner. Threaded into both the reasoning
   * step (where the model SEES the page) and the JSON step (which only has
   * the analyst notes), so the constraint survives the two-step pipeline.
   */
  ownBusinessNames?: string[],
): Promise<VisionExtractionResult> {
  const apiKey = apiKeyOverride ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'No Anthropic API key available. ' +
        'Vision-based extraction requires either a per-user BYOK key or the ANTHROPIC_API_KEY environment variable.'
    );
  }

  const client = new Anthropic({ apiKey });
  const base64Pdf = pdfBuffer.toString('base64');
  const model = getExtractionModel();

  const reasoningResponse = await createVisionMessage({
    client,
    model,
    max_tokens: VISION_REASONING_MAX_TOKENS,
    apiKeyOverride,
    content: [
      {
        type: 'text',
        text: buildVisionReasoningPrompt(vendorInstructions, ownBusinessNames),
      },
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: base64Pdf,
        },
      },
    ],
  });

  const reasoningText = collectAssistantText(reasoningResponse);
  if (!reasoningText) {
    throw new Error('No reasoning text received from Claude vision step');
  }

  console.warn(
    '[invoice-extract] Vision reasoning step (truncated 6000 chars):\n%s',
    reasoningText.length > 6000 ? `${reasoningText.slice(0, 6000)}…` : reasoningText
  );

  const u1 = calculateLlmCost(
    reasoningResponse.usage.input_tokens,
    reasoningResponse.usage.output_tokens
  );

  const jsonResponse = await createVisionMessage({
    client,
    model,
    max_tokens: VISION_JSON_MAX_TOKENS,
    apiKeyOverride,
    content: buildVisionJsonFromReasoningPrompt(reasoningText, ownBusinessNames),
  });

  const rawJsonBlock = collectAssistantText(jsonResponse);
  if (!rawJsonBlock) {
    throw new Error('No JSON step response received from Claude API');
  }

  const u2 = calculateLlmCost(
    jsonResponse.usage.input_tokens,
    jsonResponse.usage.output_tokens
  );

  const usage = sumLlmUsage([u1, u2]);

  console.warn(
    '[invoice-extract] Vision JSON step raw response:\n%s',
    rawJsonBlock
  );
  const parsed = parseInvoiceJsonFromLlmResponse(rawJsonBlock);
  console.warn(
    '[invoice-extract] Vision LLM parsed: vendorName=%s invoiceNumber=%s amount=%s currency=%s (tokens: %d in / %d out, $%s)',
    parsed.vendorName != null ? JSON.stringify(parsed.vendorName) : 'null',
    parsed.invoiceNumber != null ? JSON.stringify(parsed.invoiceNumber) : 'null',
    parsed.amount != null ? String(parsed.amount) : 'null',
    parsed.currency != null ? JSON.stringify(parsed.currency) : 'null',
    usage.inputTokens,
    usage.outputTokens,
    usage.costUsd.toFixed(6)
  );
  return { data: parsed, usage };
}
