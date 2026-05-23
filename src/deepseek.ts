/**
 * DeepSeek API integration module.
 * Uses OpenAI-compatible API format since DeepSeek's API follows that standard.
 */

const DEEPSEEK_BASE = "https://api.deepseek.com/v1";

function getApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new Error(
      "DEEPSEEK_API_KEY environment variable is required. " +
      "Set it to your DeepSeek API key."
    );
  }
  return key;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionOptions {
  model?: "deepseek-v4-flash" | "deepseek-v4-pro";
  temperature?: number;
  maxTokens?: number;
  thinking?: boolean;
}

interface DeepSeekResponse {
  id: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
      reasoning_content?: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_cache_hit_tokens: number;
    prompt_cache_miss_tokens: number;
    completion_tokens_details?: {
      reasoning_tokens: number;
    };
  };
}

/**
 * Make a chat completion call to DeepSeek API.
 * By default uses non-thinking mode (deepseek-v4-flash).
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {}
): Promise<DeepSeekResponse> {
  const {
    model = "deepseek-v4-flash",
    temperature = 0.1,
    maxTokens = 4096,
    thinking = false,
  } = options;

  const apiKey = getApiKey();
  const body: Record<string, any> = {
    model,
    messages: messages.map((m) => {
      const msg: Record<string, any> = { role: m.role, content: m.content };
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      return msg;
    }),
    max_tokens: maxTokens,
    temperature,
  };

  if (!thinking) {
    // Explicitly disable thinking by using the non-thinking prefix
    body.messages = [
      { role: "user", content: "<thinking>disabled</thinking>" },
      ...body.messages,
    ];
  }

  const resp = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`DeepSeek API error ${resp.status}: ${errText.slice(0, 500)}`);
  }

  return resp.json();
}

/**
 * Extract text content from a DeepSeek response.
 */
export function extractContent(response: DeepSeekResponse): string {
  const choice = response.choices?.[0];
  if (!choice) return "";
  // In thinking mode, content may be null; reasoning_content has the output
  return choice.message.content || choice.message.reasoning_content || "";
}

/**
 * Extract tool calls from a DeepSeek response.
 */
export function extractToolCalls(response: DeepSeekResponse): ToolCall[] {
  return response.choices?.[0]?.message?.tool_calls || [];
}

/**
 * Make a chat completion with structured output using a system prompt.
 * Returns the extracted text content.
 */
export async function analyzeWithPrompt(
  systemPrompt: string,
  userContent: string,
  options: ChatCompletionOptions = {}
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];
  const response = await chatCompletion(messages, options);
  return extractContent(response);
}
