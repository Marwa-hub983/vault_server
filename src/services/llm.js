import { config } from '../config.js';
import { HttpError } from '../middleware/errors.js';

/**
 * Creates an async iterable stream of text deltas from the configured LLM provider.
 * Connects and validates provider status before yielding, so connection/model errors
 * can be caught and returned as HTTP status codes (e.g. 503) before SSE streaming begins.
 *
 * @param {object} options
 * @param {string} [options.system] - System prompt instructions
 * @param {Array<{role: string, content: string}>} options.messages - Conversation messages
 * @returns {Promise<AsyncGenerator<string, void, unknown>>}
 */
export async function createLlmStream({ system, messages }) {
  const provider = (config.llmProvider || 'ollama').toLowerCase();

  if (provider === 'fake') {
    return (async function* () {
      const sample = 'Based on your documents [1], here is a simulated answer for testing.';
      for (const word of sample.split(' ')) {
        await new Promise((r) => setTimeout(r, 30));
        yield word + ' ';
      }
    })();
  }

  if (provider === 'anthropic') {
    return createAnthropicStream({ system, messages });
  }

  if (provider === 'ollama') {
    return createOllamaStream({ system, messages });
  }

  throw new HttpError(500, `Unknown LLM provider: ${config.llmProvider}`, 'unknown_provider');
}

/**
 * Convenience wrapper if streaming directly as an async generator
 */
export async function* streamLlm(options) {
  const stream = await createLlmStream(options);
  for await (const chunk of stream) {
    yield chunk;
  }
}

// ---------- Ollama Provider ----------
async function createOllamaStream({ system, messages }) {
  const url = `${config.ollamaUrl.replace(/\/+$/, '')}/api/chat`;

  const ollamaMessages = [];
  if (system) {
    ollamaMessages.push({ role: 'system', content: system });
  }
  for (const m of messages) {
    ollamaMessages.push({ role: m.role, content: m.content });
  }

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaModel,
        messages: ollamaMessages,
        stream: true,
      }),
    });
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
      throw new HttpError(
        503,
        `Ollama is not running at ${config.ollamaUrl}. Start Ollama and run 'ollama pull ${config.ollamaModel}'.`,
        'ollama_not_running'
      );
    }
    throw new HttpError(503, `Could not connect to Ollama: ${err.message}`, 'ollama_error');
  }

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 404 || text.toLowerCase().includes('not found')) {
      throw new HttpError(
        503,
        `Model "${config.ollamaModel}" not found in Ollama. Run 'ollama pull ${config.ollamaModel}'.`,
        'ollama_model_missing'
      );
    }
    throw new HttpError(res.status, `Ollama error (${res.status}): ${text}`, 'llm_error');
  }

  return (async function* () {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep unfinished line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.error) {
              throw new Error(parsed.error);
            }
            if (parsed.message?.content) {
              yield parsed.message.content;
            }
          } catch (e) {
            if (e.message && !e.message.startsWith('Unexpected')) throw e;
          }
        }
      }
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim());
          if (parsed.message?.content) yield parsed.message.content;
        } catch {}
      }
    } finally {
      reader.releaseLock();
    }
  })();
}

// ---------- Anthropic (Claude) Provider ----------
async function createAnthropicStream({ system, messages }) {
  if (!config.anthropicApiKey) {
    throw new HttpError(
      500,
      'ANTHROPIC_API_KEY is not configured in .env',
      'missing_api_key'
    );
  }

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': config.anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.anthropicModel,
        max_tokens: 1024,
        system: system || undefined,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      }),
    });
  } catch (err) {
    throw new HttpError(503, `Could not reach Anthropic API: ${err.message}`, 'anthropic_network_error');
  }

  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const json = JSON.parse(text);
      if (json.error?.message) msg = json.error.message;
    } catch {}
    throw new HttpError(res.status, `Claude API error: ${msg}`, 'anthropic_error');
  }

  return (async function* () {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') break;
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
              yield parsed.delta.text;
            }
          } catch {}
        }
      }
    } finally {
      reader.releaseLock();
    }
  })();
}

