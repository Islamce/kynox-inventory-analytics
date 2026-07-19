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
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  complete(messages: AiMessage[], options?: AiCompletionOptions): Promise<string>;
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

class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  constructor(readonly model: string, private apiKey: string, private baseUrl = 'https://api.anthropic.com') {}

  async complete(messages: AiMessage[], options: AiCompletionOptions = {}): Promise<string> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const chat = messages.filter((m) => m.role !== 'system');
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
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
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as { content: { type: string; text?: string }[] };
    return data.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  }
}

class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  constructor(readonly model: string, private apiKey: string, private baseUrl = 'https://api.openai.com') {}

  async complete(messages: AiMessage[], options: AiCompletionOptions = {}): Promise<string> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
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
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message?.content ?? '';
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
