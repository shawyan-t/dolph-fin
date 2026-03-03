/**
 * LLM Provider abstraction — factory pattern supporting
 * OpenAI (default), Gemini, and Groq.
 */

import type { LLMProvider, LLMProviderName, LLMConfig, LLMResponse } from '@filinglens/shared';

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
  const provider = (process.env['FILINGLENS_LLM_PROVIDER'] || 'openai') as LLMProviderName;
  const model = process.env['FILINGLENS_LLM_MODEL'] || getDefaultModel(provider);

  let apiKey = '';
  switch (provider) {
    case 'openai':
      apiKey = process.env['FILINGLENS_OPENAI_API_KEY'] || process.env['OPENAI_API_KEY'] || '';
      break;
    case 'gemini':
      apiKey = process.env['FILINGLENS_GEMINI_API_KEY'] || process.env['GEMINI_API_KEY'] || '';
      break;
    case 'groq':
      apiKey = process.env['FILINGLENS_GROQ_API_KEY'] || process.env['GROQ_API_KEY'] || '';
      break;
  }

  if (!apiKey) {
    throw new Error(
      `No API key found for provider "${provider}". ` +
      `Set FILINGLENS_${provider.toUpperCase()}_API_KEY in your .env file.`,
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

// ── OpenAI Provider ────────────────────────────────────────────

class OpenAIProvider implements LLMProvider {
  name: LLMProviderName = 'openai';
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async generate(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    // Dynamic import to avoid loading if not used
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.config.apiKey });

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await client.chat.completions.create({
      model: this.config.model,
      messages,
      temperature: 0.3,
      max_tokens: 4096,
    });

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

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async generate(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    // Use the REST API directly to avoid additional dependency
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent?key=${this.config.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as {
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
}

// ── Groq Provider ──────────────────────────────────────────────

class GroqProvider implements LLMProvider {
  name: LLMProviderName = 'groq';
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async generate(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    // Use OpenAI-compatible API (Groq uses the same format)
    const url = 'https://api.groq.com/openai/v1/chat/completions';

    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: 0.3,
        max_tokens: 4096,
      }),
    });

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
  }
}
