/**
 * AI provider abstraction. The platform never talks to a specific vendor API
 * outside this file; providers are selected by configuration and keys come
 * exclusively from environment variables.
 */

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiCompletionOptions {
  maxTokens?: number;
  temperature?: number;
  /** Abort the request after this many milliseconds. Default 60000. */
  timeoutMs?: number;
  /** Retries on network errors / 5xx / 429. Default 1. */
  retries?: number;
}

export interface AiCompletionResult {
  text: string;
  /** Token usage as reported by the provider; null when not reported. */
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  complete(messages: AiMessage[], options?: AiCompletionOptions): Promise<AiCompletionResult>;
}

export interface AiProviderConfig {
  provider: 'anthropic' | 'openai' | 'none';
  model?: string;
  apiKey?: string;
  /** Optional custom base URL (Azure-hosted or local gateways). */
  baseUrl?: string;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super('AI provider is not configured. Set AI_PROVIDER and the matching API key in the environment.');
    this.name = 'AiNotConfiguredError';
  }
}

/** Fetch with timeout + bounded retries on transient failures (network, 429, 5xx). */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  retries: number,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        lastError = new Error(`Transient AI provider error ${res.status}`);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('AI provider request failed');
}

class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  constructor(readonly model: string, private apiKey: string, private baseUrl = 'https://api.anthropic.com') {}

  async complete(messages: AiMessage[], options: AiCompletionOptions = {}): Promise<AiCompletionResult> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const chat = messages.filter((m) => m.role !== 'system');
    const res = await fetchWithRetry(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.2,
        system: system || undefined,
        messages: chat.map((m) => ({ role: m.role, content: m.content })),
      }),
    }, options.timeoutMs ?? 60_000, options.retries ?? 1);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      content: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    return {
      text: data.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join(''),
      inputTokens: data.usage?.input_tokens ?? null,
      outputTokens: data.usage?.output_tokens ?? null,
    };
  }
}

class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  constructor(readonly model: string, private apiKey: string, private baseUrl = 'https://api.openai.com') {}

  async complete(messages: AiMessage[], options: AiCompletionOptions = {}): Promise<AiCompletionResult> {
    const res = await fetchWithRetry(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.2,
        messages,
      }),
    }, options.timeoutMs ?? 60_000, options.retries ?? 1);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: data.choices[0]?.message?.content ?? '',
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null,
    };
  }
}

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-4o',
};

/** Returns a provider, or null when AI is intentionally disabled/unconfigured. */
export function createProvider(config: AiProviderConfig): AiProvider | null {
  if (config.provider === 'none' || !config.apiKey) return null;
  const model = config.model || DEFAULT_MODELS[config.provider];
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(model, config.apiKey, config.baseUrl);
    case 'openai':
      return new OpenAiProvider(model, config.apiKey, config.baseUrl);
    default:
      return null;
  }
}
