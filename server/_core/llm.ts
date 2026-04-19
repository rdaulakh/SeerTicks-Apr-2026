import { ENV } from "./env";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" ;
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }

  if (part.type === "text") {
    return part;
  }

  if (part.type === "image_url") {
    return part;
  }

  if (part.type === "file_url") {
    return part;
  }

  throw new Error("Unsupported message content part");
};

const normalizeMessage = (message: Message) => {
  const { role, name, tool_call_id } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");

    return {
      role,
      name,
      tool_call_id,
      content,
    };
  }

  const contentParts = ensureArray(message.content).map(normalizeContentPart);

  // If there's only text content, collapse to a single string for compatibility
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text,
    };
  }

  return {
    role,
    name,
    content: contentParts,
  };
};

const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;

  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }

    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }

    return {
      type: "function",
      function: { name: tools[0].function.name },
    };
  }

  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }

  return toolChoice;
};

/**
 * Resolve provider (openai vs forge) + URL + key + model.
 *
 * Precedence:
 *   1. OpenAI direct (OPENAI_API_KEY set) — preferred post-Manus.
 *   2. Forge proxy (BUILT_IN_FORGE_API_KEY set) — legacy Manus-managed gateway.
 *
 * Why the provider matters: Forge (Gemini) accepts a `thinking.budget_tokens`
 * payload and max_tokens up to 32768. OpenAI rejects both — we need to strip
 * them for the OpenAI path, so callers below branch on `isForge`.
 */
type LlmProvider = {
  kind: "openai" | "forge";
  url: string;
  key: string;
  model: string;
};

const resolveProvider = (): LlmProvider => {
  if (ENV.openaiApiKey) {
    const base = ENV.openaiApiUrl.replace(/\/$/, "");
    const url = base.endsWith("/chat/completions")
      ? base
      : `${base}/chat/completions`;
    return {
      kind: "openai",
      url,
      key: ENV.openaiApiKey,
      model: ENV.openaiModel || "gpt-4o-mini",
    };
  }

  const forgeBase = (ENV.forgeApiUrl || "https://forge.manus.im").replace(/\/$/, "");
  return {
    kind: "forge",
    url: `${forgeBase}/v1/chat/completions`,
    key: ENV.forgeApiKey,
    model: "gemini-2.5-flash",
  };
};

const assertApiKey = (p: LlmProvider) => {
  if (!p.key) {
    throw new Error(
      p.kind === "openai"
        ? "OPENAI_API_KEY is not configured"
        : "BUILT_IN_FORGE_API_KEY is not configured",
    );
  }
};

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (
      explicitFormat.type === "json_schema" &&
      !explicitFormat.json_schema?.schema
    ) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;

  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

/**
 * Primary LLM invocation with circuit breaker and fallback chain.
 * 
 * Flow:
 *   1. Check circuit breaker — if OPEN, skip primary and go to fallback
 *   2. Try primary (Forge/Gemini)
 *   3. On quota exhaustion (412), record failure and try Anthropic fallback
 *   4. If fallback unavailable or fails, throw original error
 */
export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const { getLLMCircuitBreaker } = await import('../utils/LLMCircuitBreaker');
  const circuitBreaker = getLLMCircuitBreaker();

  // If circuit is open, skip primary entirely and try fallback
  if (!circuitBreaker.canExecute()) {
    return tryFallback(params, circuitBreaker, new Error('Circuit breaker OPEN — primary LLM blocked'));
  }

  try {
    const result = await invokePrimaryLLM(params);
    circuitBreaker.recordSuccess();
    return result;
  } catch (error) {
    const err = error as Error;
    if (circuitBreaker.isQuotaExhausted(err)) {
      circuitBreaker.recordFailure(err);
      return tryFallback(params, circuitBreaker, err);
    }
    // Non-quota errors pass through without affecting circuit
    throw error;
  }
}

/**
 * Try Anthropic fallback when primary LLM is unavailable
 */
async function tryFallback(
  params: InvokeParams,
  circuitBreaker: ReturnType<typeof import('../utils/LLMCircuitBreaker').getLLMCircuitBreaker>,
  originalError: Error
): Promise<InvokeResult> {
  const { isAnthropicAvailable, invokeAnthropicFallback } = await import('../utils/AnthropicFallback');

  if (!isAnthropicAvailable()) {
    console.warn('[LLM] Primary exhausted, no fallback available — throwing original error');
    throw originalError;
  }

  try {
    console.log('[LLM] 🔄 Falling back to Anthropic Claude...');
    const result = await invokeAnthropicFallback(params);
    circuitBreaker.recordFallback();
    console.log('[LLM] ✅ Anthropic fallback succeeded');
    return result;
  } catch (fallbackError) {
    console.error('[LLM] ❌ Anthropic fallback also failed:', fallbackError);
    // Throw the original error (more informative)
    throw originalError;
  }
}

/**
 * Internal: invoke the primary Forge/Gemini LLM
 */
async function invokePrimaryLLM(params: InvokeParams): Promise<InvokeResult> {
  const provider = resolveProvider();
  assertApiKey(provider);

  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
    maxTokens,
    max_tokens,
  } = params;

  const payload: Record<string, unknown> = {
    model: provider.model,
    messages: messages.map(normalizeMessage),
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }

  // max_tokens: callers can override; per-provider safe defaults otherwise.
  // OpenAI gpt-4o-mini supports up to 16384 completion tokens; Gemini forge path
  // historically used 32768.
  const callerMax = maxTokens ?? max_tokens;
  payload.max_tokens =
    callerMax ?? (provider.kind === "openai" ? 4096 : 32768);

  // `thinking` is Gemini/Forge-specific — OpenAI rejects unknown fields.
  if (provider.kind === "forge") {
    payload.thinking = { budget_tokens: 128 };
  }

  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });

  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }

  const response = await fetch(provider.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.key}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM invoke failed (${provider.kind}): ${response.status} ${response.statusText} – ${errorText}`
    );
  }

  return (await response.json()) as InvokeResult;
}
