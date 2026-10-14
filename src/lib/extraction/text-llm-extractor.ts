/**
 * Single LLM call for text-based PDFs: same JSON schema as vision (invoice-llm-extraction.ts).
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ExtractedInvoiceData, LlmTokenUsage } from '@/types/invoice';
import {
  buildTextUserPrompt,
  parseInvoiceJsonFromLlmResponse,
} from './invoice-llm-extraction';
import { calculateLlmCost } from './llm-cost';
import {
  AnthropicModelAccessError,
  getExtractionModel,
  isAnthropicModelNotFound,
} from './anthropic-models';

/**
 * Full invoice field extraction from plain PDF text (one Claude call, same fields as vision).
 * Returns null if ANTHROPIC_API_KEY is missing (caller keeps regex/heuristics only).
 */
export interface TextExtractionResult {
  data: ExtractedInvoiceData;
  usage: LlmTokenUsage;
}

export async function extractWithTextLlm(
  rawText: string,
  vendorInstructions?: string,
  /**
   * Per-user (BYOK) Anthropic key. When provided, it overrides the shared
   * platform key for this single call so BYOK users pay Anthropic directly.
   */
  apiKeyOverride?: string,
  /**
   * Names belonging to the account owner (own company name + income-source
   * vendor names). Passed to the prompt so the model treats them as the
   * recipient/customer and never picks them as vendorName.
   */
  ownBusinessNames?: string[],
  /**
   * Layout-aware version of `rawText` (rows preserved, columns indented to
   * mirror PDF x positions). When provided we prefer it as the prompt body
   * — Hebrew multi-column invoices (חשבשבת and friends) are unreadable as
   * a single flat line; the LLM otherwise mistakes the customer block on
   * the right for the vendor letterhead. See `text-extractor.ts`.
   */
  layoutText?: string,
): Promise<TextExtractionResult | null> {
  const apiKey = apiKeyOverride ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }

  const client = new Anthropic({ apiKey });
  const model = getExtractionModel();

  const promptText =
    layoutText && layoutText.trim().length > 0 ? layoutText : rawText;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: buildTextUserPrompt(
            promptText,
            vendorInstructions,
            ownBusinessNames,
          ),
        },
      ],
    });

    const usage = calculateLlmCost(
      response.usage.input_tokens,
      response.usage.output_tokens
    );

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return null;
    }

    const rawResponse = textBlock.text;
    console.warn(
      '[invoice-extract] Text LLM raw response:\n%s',
      rawResponse
    );
    const parsed = parseInvoiceJsonFromLlmResponse(rawResponse);
    console.warn(
      '[invoice-extract] Text LLM parsed: vendorName=%s invoiceNumber=%s amount=%s currency=%s (tokens: %d in / %d out, $%s)',
      parsed.vendorName != null ? JSON.stringify(parsed.vendorName) : 'null',
      parsed.invoiceNumber != null ? JSON.stringify(parsed.invoiceNumber) : 'null',
      parsed.amount != null ? String(parsed.amount) : 'null',
      parsed.currency != null ? JSON.stringify(parsed.currency) : 'null',
      usage.inputTokens,
      usage.outputTokens,
      usage.costUsd.toFixed(6)
    );
    return { data: parsed, usage };
  } catch (e) {
    // Surface model-access errors to the caller so the upload route can
    // tell the user their BYOK key can't reach the configured model.
    // Any other error keeps the original "fall back to regex" behaviour.
    if (isAnthropicModelNotFound(e)) {
      throw new AnthropicModelAccessError(
        model,
        apiKeyOverride ? 'user' : 'platform',
        e
      );
    }
    console.error('[invoice-extract] Text LLM extraction failed:', e);
    return null;
  }
}
