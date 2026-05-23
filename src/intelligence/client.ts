import { getConfig } from "../config.js";
import { estimateTokenCount, extractJsonFromResponse } from "../utils/text.js";
import { logger } from "../utils/logger.js";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  thinking?: boolean;
  jsonMode?: boolean;
  retries?: number;
}

export class DeepSeekClient {
  private apiKey: string;
  private baseUrl: string;
  private proModel: string;
  private flashModel: string;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor() {
    const config = getConfig().llm;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.proModel = config.proModel;
    this.flashModel = config.flashModel;
    this.maxRetries = config.maxRetries;
    this.retryDelayMs = config.retryDelayMs;
  }

  async analyze(
    systemPrompt: string,
    userContent: string,
    options: ChatOptions = {}
  ): Promise<string> {
    const {
      model = this.proModel,
      temperature = 0.1,
      maxTokens = 4096,
      thinking = true,
      jsonMode = false,
      retries = this.maxRetries,
    } = options;

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ];

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        const delay = this.retryDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500;
        logger.debug({ attempt, delay }, "retrying DeepSeek call");
        await new Promise((r) => setTimeout(r, delay));
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120000);

        const body: Record<string, any> = {
          model,
          messages,
          max_tokens: maxTokens,
          temperature,
        };

        if (jsonMode) {
          body.response_format = { type: "json_object" };
          // DeepSeek requires the prompt to contain "json" when using json_object mode
          messages[messages.length - 1].content += "\nRespond in JSON format.";
        }

        if (!thinking) {
          body.messages = [{ role: "user", content: "<thinking>disabled</thinking>" }, ...body.messages];
        }

        const resp = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!resp.ok) {
          const errText = await resp.text().catch(() => "unknown");
          throw new Error(`DeepSeek API error ${resp.status}: ${errText.slice(0, 500)}`);
        }

        const data = await resp.json();
        const choice = data.choices?.[0];
        const text = choice?.message?.content || choice?.message?.reasoning_content || "";

        // Log token usage
        if (data.usage) {
          logger.debug(
            {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            },
            "DeepSeek API call completed"
          );
        }

        return text;
      } catch (err: any) {
        lastError = err;
        if (err.name === "AbortError" || err.message?.includes("timeout")) {
          logger.warn({ attempt }, "DeepSeek call timed out");
        } else if (err.message?.includes("429")) {
          logger.warn({ attempt }, "DeepSeek rate limited, will retry with longer delay");
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }

    throw lastError || new Error("DeepSeek API call failed after retries");
  }

  async analyzeStructured(
    systemPrompt: string,
    userContent: string,
    options: ChatOptions = {}
  ): Promise<Record<string, any>> {
    const text = await this.analyze(systemPrompt, userContent, {
      ...options,
      jsonMode: true,
      thinking: false,
    });
    const jsonStr = extractJsonFromResponse(text);
    try {
      return JSON.parse(jsonStr);
    } catch {
      logger.warn({ responsePreview: text.slice(0, 300) }, "failed to parse JSON from DeepSeek response");
      return {};
    }
  }
}

let _client: DeepSeekClient | null = null;

export function getDeepSeekClient(): DeepSeekClient {
  if (!_client) _client = new DeepSeekClient();
  return _client;
}
