/**
 * LLM Provider abstraction — factory pattern supporting
 * OpenAI (default), Gemini, and Groq.
 *
 * All providers have a hard timeout (default 60s) to prevent
 * infinite hangs under provider outage.
 */

import type { LLMProvider, LLMProviderName, LLMConfig, LLMResponse } from '@dolph/shared';

/** Hard timeout for any single LLM call (60 seconds) */
const LLM_TIMEOUT_MS = 60_000;

export function createLLMProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'gemini':
      return new GeminiProvider(config);
    case 'groq':
      return new GroqProvider(config);
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

/**
 * Get LLM config from environment variables.
 */
export function getLLMConfig(): LLMConfig {
  const provider = (process.env['DOLPH_LLM_PROVIDER'] || 'openai') as LLMProviderName;
  const model = process.env['DOLPH_LLM_MODEL'] || getDefaultModel(provider);

  let apiKey = '';
  switch (provider) {
    case 'openai':
      apiKey = process.env['DOLPH_OPENAI_API_KEY'] || process.env['OPENAI_API_KEY'] || '';
      break;
    case 'gemini':
      apiKey = process.env['DOLPH_GEMINI_API_KEY'] || process.env['GEMINI_API_KEY'] || '';
      break;
    case 'groq':
      apiKey = process.env['DOLPH_GROQ_API_KEY'] || process.env['GROQ_API_KEY'] || '';
      break;
  }

  if (!apiKey) {
    throw new Error(
      `No API key found for provider "${provider}". ` +
      `Set DOLPH_${provider.toUpperCase()}_API_KEY in your .env file.`,
    );
  }

  return { provider, model, apiKey };
}

function getDefaultModel(provider: LLMProviderName): string {
  switch (provider) {
    case 'openai': return 'gpt-4o-mini';
    case 'gemini': return 'gemini-2.5-flash';
    case 'groq': return 'llama-3.3-70b-versatile';
  }
}

/** Wrap a promise with a hard timeout */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise
      .then(result => { clearTimeout(timer); resolve(result); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise(resolve => setTimeout(resolve, ms));
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('LLM call aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new Error('LLM call aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// ── OpenAI Provider ────────────────────────────────────────────

class OpenAIProvider implements LLMProvider {
  name: LLMProviderName = 'openai';
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async generate(
    prompt: string,
    systemPrompt?: string,
    options?: { temperature?: number; signal?: AbortSignal; maxTokens?: number; jsonMode?: boolean },
  ): Promise<LLMResponse> {
    if (options?.signal?.aborted) {
      throw new Error('OpenAI API call aborted');
    }

    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.config.apiKey, timeout: LLM_TIMEOUT_MS });

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await withTimeout(
      client.chat.completions.create(
        {
          model: this.config.model,
          messages,
          temperature: options?.temperature ?? 0.3,
          max_tokens: options?.maxTokens ?? 4096,
          ...(options?.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
        },
        { signal: options?.signal } as { signal?: AbortSignal },
      ),
      LLM_TIMEOUT_MS,
      'OpenAI API call',
    );

    const choice = response.choices[0];
    return {
      content: choice?.message?.content || '',
      usage: {
        input_tokens: response.usage?.prompt_tokens || 0,
        output_tokens: response.usage?.completion_tokens || 0,
      },
      model: response.model,
    };
  }
}

// ── Gemini Provider ────────────────────────────────────────────

class GeminiProvider implements LLMProvider {
  name: LLMProviderName = 'gemini';
  private config: LLMConfig;
  private maxRetries = 3;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async generate(
    prompt: string,
    systemPrompt?: string,
    options?: { temperature?: number; signal?: AbortSignal; maxTokens?: number; jsonMode?: boolean },
  ): Promise<LLMResponse> {
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent?key=${this.config.apiKey}`;
    const body = JSON.stringify({
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: {
        temperature: options?.temperature ?? 0.3,
        maxOutputTokens: options?.maxTokens ?? 4096,
        ...(options?.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    });

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (options?.signal?.aborted) {
        throw new Error('Gemini API call aborted');
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
      const onExternalAbort = () => controller.abort();
      options?.signal?.addEventListener('abort', onExternalAbort, { once: true });

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });

        clearTimeout(timer);
        const responseText = await response.text();

        if (response.ok) {
          const data = JSON.parse(responseText) as {
            candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
            usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
          };

          return {
            content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
            usage: {
              input_tokens: data.usageMetadata?.promptTokenCount || 0,
              output_tokens: data.usageMetadata?.candidatesTokenCount || 0,
            },
            model: this.config.model,
          };
        }

        if (response.status === 429 && attempt < this.maxRetries) {
          const retryMatch = responseText.match(/"retryDelay"\s*:\s*"(\d+)/);
          const waitSec = retryMatch ? parseInt(retryMatch[1]!, 10) : 30 * (attempt + 1);
          const waitMs = (waitSec + 2) * 1000;

          process.stderr.write(
            `\x1B[33m  ⏳ Rate limited — waiting ${waitSec + 2}s before retry (${attempt + 1}/${this.maxRetries})...\x1B[0m\n`,
          );
          await sleepWithSignal(waitMs, options?.signal);
          continue;
        }

        throw new Error(`Gemini API error: ${response.status} ${responseText}`);
      } catch (err) {
        clearTimeout(timer);
        options?.signal?.removeEventListener('abort', onExternalAbort);
        if (options?.signal?.aborted) {
          throw new Error('Gemini API call aborted');
        }
        if (err instanceof Error && err.name === 'AbortError') {
          if (attempt < this.maxRetries) continue;
          throw new Error(`Gemini API timed out after ${LLM_TIMEOUT_MS}ms`);
        }
        throw err;
      } finally {
        options?.signal?.removeEventListener('abort', onExternalAbort);
      }
    }

    throw new Error('Gemini API: max retries exceeded');
  }
}

// ── Groq Provider ──────────────────────────────────────────────

class GroqProvider implements LLMProvider {
  name: LLMProviderName = 'groq';
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async generate(
    prompt: string,
    systemPrompt?: string,
    options?: { temperature?: number; signal?: AbortSignal; maxTokens?: number; jsonMode?: boolean },
  ): Promise<LLMResponse> {
    if (options?.signal?.aborted) {
      throw new Error('Groq API call aborted');
    }

    const url = 'https://api.groq.com/openai/v1/chat/completions';

    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    const onExternalAbort = () => controller.abort();
    options?.signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: options?.temperature ?? 0.3,
          max_tokens: options?.maxTokens ?? 4096,
          ...(options?.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq API error: ${response.status} ${errorText}`);
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
        usage: { prompt_tokens: number; completion_tokens: number };
        model: string;
      };

      return {
        content: data.choices?.[0]?.message?.content || '',
        usage: {
          input_tokens: data.usage?.prompt_tokens || 0,
          output_tokens: data.usage?.completion_tokens || 0,
        },
        model: data.model || this.config.model,
      };
    } catch (err) {
      clearTimeout(timer);
      options?.signal?.removeEventListener('abort', onExternalAbort);
      if (options?.signal?.aborted) {
        throw new Error('Groq API call aborted');
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Groq API timed out after ${LLM_TIMEOUT_MS}ms`);
      }
      throw err;
    } finally {
      options?.signal?.removeEventListener('abort', onExternalAbort);
    }
  }
}
