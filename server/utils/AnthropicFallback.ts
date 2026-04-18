/**
 * Anthropic Claude Fallback Provider
 * 
 * When the primary LLM (Forge/Gemini) is exhausted, this module provides
 * a fallback using the Anthropic Claude API. It translates the OpenAI-style
 * message format used by invokeLLM into Anthropic's native format.
 * 
 * Key features:
 * - Translates OpenAI message format → Anthropic native format
 * - Detects JSON-expected responses and enforces structured output via prefill
 * - Handles response_format parameter (json_schema / json_object)
 * - Returns OpenAI-compatible InvokeResult
 * 
 * Requires ANTHROPIC_API_KEY environment variable.
 */

import type { InvokeParams, InvokeResult, Message } from '../_core/llm';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Check if Anthropic fallback is available
 */
export function isAnthropicAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Detect if the conversation expects a JSON response.
 * Checks system prompt, user messages, and response_format parameter.
 */
function expectsJsonResponse(params: InvokeParams, systemPrompt: string): boolean {
  // Explicit response_format
  if (params.response_format) {
    const type = (params.response_format as any).type;
    if (type === 'json_schema' || type === 'json_object') return true;
  }

  // Check system prompt for JSON indicators
  const jsonIndicators = [
    'return only valid json',
    'return only a valid json',
    'respond with json',
    'output json',
    'return json',
    'valid json object',
    'json format',
    'json response',
    'designed to output json',
    'return only a json',
    'respond only with json',
    'respond in json',
  ];
  const lowerSystem = systemPrompt.toLowerCase();
  if (jsonIndicators.some(indicator => lowerSystem.includes(indicator))) return true;

  // Check user messages for JSON structure requests
  const allContent = params.messages
    .filter(m => m.role === 'user')
    .map(m => typeof m.content === 'string' ? m.content : '')
    .join(' ')
    .toLowerCase();
  if (jsonIndicators.some(indicator => allContent.includes(indicator))) return true;

  return false;
}

/**
 * Convert OpenAI-style messages to Anthropic format
 */
function convertMessages(messages: Message[]): { system: string; messages: any[] } {
  let systemPrompt = '';
  const anthropicMessages: any[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Anthropic uses a separate system parameter
      const content = typeof msg.content === 'string' 
        ? msg.content 
        : Array.isArray(msg.content) 
          ? msg.content.map(c => typeof c === 'string' ? c : (c as any).text || '').join('\n')
          : '';
      systemPrompt += (systemPrompt ? '\n\n' : '') + content;
      continue;
    }

    if (msg.role === 'user' || msg.role === 'assistant') {
      let content: string;
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .map(c => typeof c === 'string' ? c : (c as any).text || JSON.stringify(c))
          .join('\n');
      } else {
        content = String(msg.content);
      }

      anthropicMessages.push({
        role: msg.role,
        content,
      });
    }
  }

  // Ensure messages alternate user/assistant (Anthropic requirement)
  // If first message isn't user, prepend a user message
  if (anthropicMessages.length > 0 && anthropicMessages[0].role !== 'user') {
    anthropicMessages.unshift({ role: 'user', content: 'Please continue.' });
  }

  return { system: systemPrompt, messages: anthropicMessages };
}

/**
 * Invoke Anthropic Claude as a fallback LLM
 * Returns result in the same InvokeResult format as the primary LLM
 * 
 * Handles JSON enforcement:
 * - Detects when JSON output is expected (from system prompt, user messages, or response_format)
 * - Adds JSON enforcement to system prompt
 * - Uses assistant prefill technique to force JSON output
 * - Extracts JSON from response even if wrapped in text
 */
export async function invokeAnthropicFallback(params: InvokeParams): Promise<InvokeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured — fallback unavailable');
  }

  const { system, messages } = convertMessages(params.messages);
  const jsonExpected = expectsJsonResponse(params, system);

  // Enhance system prompt for JSON responses
  let enhancedSystem = system;
  if (jsonExpected) {
    enhancedSystem += '\n\nCRITICAL: You MUST respond with ONLY valid JSON. No explanations, no markdown, no code blocks, no prose. Just the raw JSON object. If you cannot provide the requested data, return a valid JSON object with sensible defaults (e.g., {"sentiment": 0, "summary": "Data unavailable", "sources": []}).';
  }

  const payload: Record<string, unknown> = {
    model: ANTHROPIC_MODEL,
    max_tokens: params.maxTokens || params.max_tokens || 4096,
    messages: [...messages],
  };

  if (enhancedSystem) {
    payload.system = enhancedSystem;
  }

  // Use assistant prefill to force JSON output
  // This is Anthropic's recommended technique for structured output
  if (jsonExpected) {
    const msgArray = payload.messages as any[];
    // Add assistant prefill with opening brace to force JSON
    msgArray.push({
      role: 'assistant',
      content: '{',
    });
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic fallback failed: ${response.status} ${response.statusText} – ${errorText}`);
  }

  const result = await response.json() as any;

  // Convert Anthropic response to OpenAI-compatible InvokeResult format
  let textContent = result.content
    ?.filter((c: any) => c.type === 'text')
    ?.map((c: any) => c.text)
    ?.join('') || '';

  // If we used prefill, prepend the opening brace back
  if (jsonExpected) {
    textContent = '{' + textContent;
    // Clean up: extract valid JSON if there's trailing text
    textContent = extractJson(textContent);
  }

  return {
    id: result.id || `anthropic-${Date.now()}`,
    created: Math.floor(Date.now() / 1000),
    model: result.model || ANTHROPIC_MODEL,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: textContent,
      },
      finish_reason: result.stop_reason === 'end_turn' ? 'stop' : result.stop_reason || 'stop',
    }],
    usage: result.usage ? {
      prompt_tokens: result.usage.input_tokens || 0,
      completion_tokens: result.usage.output_tokens || 0,
      total_tokens: (result.usage.input_tokens || 0) + (result.usage.output_tokens || 0),
    } : undefined,
  };
}

/**
 * Extract valid JSON from a string that may contain surrounding text.
 * Handles cases where the model wraps JSON in markdown or adds explanations.
 */
function extractJson(text: string): string {
  // Remove markdown code blocks
  let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  // Try to parse as-is first
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    // Not valid JSON as-is
  }

  // Try to find a JSON object in the text
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      JSON.parse(objectMatch[0]);
      return objectMatch[0];
    } catch {
      // Not a valid JSON object
    }
  }

  // Try to find a JSON array in the text
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      JSON.parse(arrayMatch[0]);
      return arrayMatch[0];
    } catch {
      // Not a valid JSON array
    }
  }

  // Return cleaned text as last resort — caller will handle parse error
  return cleaned;
}
