// @ts-ignore - Bypass ESM/CommonJS restriction since the SDK natively supports both
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import OpenAI from 'openai';

// Module-level NanoGPT client (subscription-only) for chat + image generation
let nanoClient: OpenAI | null = null;

export function getNanoClient() {
  if (!nanoClient) {
    // Subscription-only base so only models from the NanoGPT Pro/sub roster are available
    nanoClient = new OpenAI({
      baseURL: 'https://nano-gpt.com/api/subscription/v1',
      apiKey: process.env.NANOGPT_API_KEY || 'dummy-key-to-prevent-crash',
    });
  }
  return nanoClient;
}

interface ModelConfig {
  id: string;
  provider: 'gemini' | 'openrouter' | 'nanogpt';
}

let currentModel: ModelConfig = { id: 'gemma-4-31b-it', provider: 'gemini' };

const OPENROUTER_SERVER_TOOLS = [
  { type: 'openrouter:web_search', parameters: { max_results: 8 } },
  { type: 'openrouter:web_fetch' },
  { type: 'openrouter:datetime' },
];

const FALLBACK_MODELS: ModelConfig[] = [
  { id: 'gemini-2.5-flash', provider: 'gemini' },
  { id: 'gemini-3.1-flash-lite-preview', provider: 'gemini' },
  { id: 'gemma-4-31b-it', provider: 'gemini' },
  { id: 'gemma-4-26b-a4b-it', provider: 'gemini' },
  { id: 'gemini-1.5-flash', provider: 'gemini' },
  { id: 'gemini-2.5-pro', provider: 'gemini' },
];

export function switchModel(id: string, provider: 'gemini' | 'openrouter' | 'nanogpt') {
  currentModel = { id, provider };
  return `Switched to **${id}** (${provider})`;
}

export function getCurrentModel() {
  return currentModel;
}

export const TASK_MODELS: ModelConfig[] = [
  { id: 'gemma-4-31b-it', provider: 'gemini' },
  { id: 'gemma-4-26b-a4b-it', provider: 'gemini' },
];

// ==================== TOOL HELPERS ====================

function getOpenRouterTools(tools: any[] = []) {
  // Always give OpenRouter models powerful web tools
  const serverTools = [...OPENROUTER_SERVER_TOOLS];

  // Merge with any user-provided tools, avoiding duplicates
  const existingTypes = new Set(tools.map(t => t.type));
  const finalTools = [...tools, ...serverTools.filter(t => !existingTypes.has(t.type))];

  return finalTools;
}

function getGeminiTools(
  modelId: string,
  tools: any[] | undefined,
  isDefaultConversationRequest: boolean
) {
  const geminiTools = [...(tools || [])];
  const hasGoogleSearch = geminiTools.some(tool => 'googleSearch' in tool);

  // Always try to enable googleSearch for Gemini models (especially Gemma)
  if (!hasGoogleSearch && isDefaultConversationRequest) {
    geminiTools.push({ googleSearch: {} });
  }

  return geminiTools;
}

// ==================== NANOGPT WEB TOOLS (client-side, using your subscription) ====================
// These give ANY model on the NanoGPT roster (that supports tool calling) access to web search + fetch.

const WEB_SEARCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description: 'Search the web for up-to-date information, news, facts, or current events. Always use this for anything time-sensitive or external knowledge.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Clear search query' },
      },
      required: ['query'],
    },
  },
};

const WEB_FETCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_fetch',
    description: 'Fetch and read the main text content of a specific webpage URL. Use after web_search when you need the full details from a promising link.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The full http(s) URL to fetch' },
      },
      required: ['url'],
    },
  },
};

const NANO_GPT_WEB_TOOLS = [WEB_SEARCH_TOOL, WEB_FETCH_TOOL];

async function performWebSearch(query: string): Promise<string> {
  const apiKey = process.env.NANOGPT_API_KEY;
  if (!apiKey) return 'Web search unavailable (no NANOGPT_API_KEY).';

  try {
    const res = await fetch('https://nano-gpt.com/api/v1/data/web/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        provider: 'linkup',
        depth: 'standard',
        outputType: 'sourcedAnswer',
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return `Search failed (${res.status}): ${errText.slice(0, 200)}`;
    }

    const data = await res.json();
    // Try to give the model a clean, useful summary
    if (data?.data && typeof data.data === 'string') {
      return `Search results for "${query}":\n${data.data}`;
    }
    if (Array.isArray(data?.data)) {
      return `Search results for "${query}":\n` + data.data.map((r: any, i: number) =>
        `${i + 1}. ${r.title || r.name || ''} — ${r.url || r.link || ''}\n   ${r.snippet || r.summary || r.content || ''}`
      ).join('\n');
    }
    return `Search results:\n${JSON.stringify(data).slice(0, 3000)}`;
  } catch (e: any) {
    return `Web search error: ${e.message || e}`;
  }
}

async function performWebFetch(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Nova-Discord/1.0' } });
    if (!res.ok) return `Fetch failed: ${res.status} ${res.statusText}`;
    const text = await res.text();
    // Crude but effective: strip tags + collapse whitespace + truncate
    const cleaned = text
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const excerpt = cleaned.slice(0, 7000);
    return `Content from ${url} (first ~7k chars):\n${excerpt}`;
  } catch (e: any) {
    return `Fetch error for ${url}: ${e.message || e}`;
  }
}

async function executeTool(name: string, args: any = {}): Promise<string> {
  if (name === 'recall_recent_inner_world' || name === 'recall_my_recent_inner_world') {
    // Dynamic import avoids init cycle (inner_world -> offscreen -> ai)
    const mod = await import('./inner_world.js');
    return mod.getFullRecentInnerWorld();
  }
  if (name === 'web_search') {
    return performWebSearch(args.query || args.q || '');
  }
  if (name === 'web_fetch') {
    return performWebFetch(args.url || '');
  }
  return `Unknown tool: ${name}`;
}

function convertToStandardTools(tools: any[] = []): any[] {
  return tools.map(t => {
    if (t.type === 'function' && t.function) return t;
    if (t.name) {
      return {
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.parameters || { type: 'object', properties: {} },
        },
      };
    }
    return t;
  });
}

// ==================== MAIN GENERATION FUNCTION ====================

export async function generateContentWithFallback(
  prompt: string | any[],
  tools: any[] = [],
  preferredModels?: ModelConfig[]
) {
  // Clients created on demand inside the loop to support multiple providers cleanly
  let gemini: GoogleGenAI | null = null;
  let orClient: OpenAI | null = null;

  function getGemini() {
    if (!gemini) gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    return gemini;
  }
  function getORClient() {
    if (!orClient) {
      orClient = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY || 'dummy-key-to-prevent-crash',
      });
    }
    return orClient;
  }

  const isDefaultConversationRequest = !preferredModels || preferredModels.length === 0;

  let modelsToTry: ModelConfig[] =
    preferredModels && preferredModels.length > 0
      ? [...preferredModels, ...FALLBACK_MODELS]
      : [currentModel, ...FALLBACK_MODELS.filter(m => m.id !== currentModel.id)];

  // Shared helper to turn our prompt (string or gemini-style parts) into OpenAI chat messages
  function buildMessagesFromPrompt(p: string | any[]): any[] {
    if (typeof p === 'string') {
      return [{ role: 'user', content: p }];
    }
    if (Array.isArray(p)) {
      const content = p.map(part => {
        if (part.text) return { type: 'text', text: part.text };
        if (part.inlineData) {
          return {
            type: 'image_url',
            image_url: {
              url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
            },
          };
        }
        return { type: 'text', text: JSON.stringify(part) };
      });
      return [{ role: 'user', content }];
    }
    return [{ role: 'user', content: '' }];
  }

  for (const modelConfig of modelsToTry) {
    try {
      if (modelConfig.provider === 'gemini') {
        const g = getGemini();
        const geminiTools = getGeminiTools(modelConfig.id, tools, isDefaultConversationRequest);

        const geminiConfig: any = {
          temperature: 1.2,
          tools: geminiTools.length > 0 ? geminiTools : undefined,
        };

        // Add high thinking level (helps with tool use / search quality)
        if (isDefaultConversationRequest) {
          geminiConfig.thinkingConfig = {
            thinkingLevel: ThinkingLevel.HIGH,
          };
        }

        const options: any = {
          model: modelConfig.id,
          config: geminiConfig,
          contents: prompt,
        };

        const response = await g.models.generateContent(options);
        return { text: response.text };
      }

      // ==================== OPENROUTER (DeepSeek, etc. — keep server tools behavior) ====================
      else if (modelConfig.provider === 'openrouter') {
        const client = getORClient();
        const messages = buildMessagesFromPrompt(prompt);
        const openRouterTools = getOpenRouterTools(tools);

        const options: any = {
          model: modelConfig.id,
          messages,
          temperature: 1.2,
          tools: openRouterTools.length > 0 ? openRouterTools : undefined,
        };

        // Special reasoning config for DeepSeek v4
        if (modelConfig.id.includes('deepseek-v4')) {
          options.reasoning = { effort: 'high' };
          options.tool_choice = 'auto';
          options.parallel_tool_calls = true;
        }

        const response = await client.chat.completions.create(options);
        return { text: response.choices[0]?.message?.content || '' };
      }

      // ==================== NANOGPT (any model from your Pro/sub roster) ====================
      else if (modelConfig.provider === 'nanogpt') {
        const client = getNanoClient();
        let messages = buildMessagesFromPrompt(prompt);

        // Always give NanoGPT models the inner-world tool + our web search/fetch
        // (converted to standard OpenAI function format). Models that support tool_calling will use them.
        const standardPassedTools = convertToStandardTools(tools);
        const nanoTools = [...standardPassedTools, ...NANO_GPT_WEB_TOOLS];

        const optionsBase: any = {
          model: modelConfig.id,
          temperature: 1.2,
          tools: nanoTools.length > 0 ? nanoTools : undefined,
        };

        // Bounded tool-calling loop so web_search / web_fetch / recall can actually run
        const MAX_ROUNDS = 4;
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const resp = await client.chat.completions.create({
            ...optionsBase,
            messages,
          });

          const msg = resp.choices[0]?.message;
          if (!msg) break;

          const toolCalls = msg.tool_calls;
          if (toolCalls && toolCalls.length > 0) {
            // Push the assistant message that requested tools
            messages.push(msg);

            for (const tc of toolCalls) {
              // OpenAI SDK types are a union; use any access for function tool calls
              const funcPart: any = (tc as any).function || tc;
              const name = funcPart?.name || '';
              let args: any = {};
              try {
                args = funcPart?.arguments ? JSON.parse(funcPart.arguments) : {};
              } catch {}
              const resultText = await executeTool(name, args);
              messages.push({
                role: 'tool',
                tool_call_id: (tc as any).id,
                content: String(resultText),
              });
            }
            // Continue loop — model will get the tool results in next turn
            continue;
          }

          // No more tool calls — final answer
          return { text: msg.content || '' };
        }

        // If we exhausted rounds, return whatever we have
        return { text: '' };
      }
    } catch (e: any) {
      console.log(
        `[⚠️] Model ${modelConfig.id} failed (${e.status || e.message || 'unknown error'}). Falling back...`
      );
      if (modelConfig === modelsToTry[modelsToTry.length - 1]) throw e;
    }
  }

  throw new Error('All fallback models failed.');
}

// ==================== NANOGPT IMAGE GENERATION (replaces AI Horde) ====================
// Uses the subscription-only path so only roster-included image models are available.
// Always returns a Buffer (b64_json) so handler can attach directly.

export async function generateImage(prompt: string, model?: string): Promise<Buffer> {
  const client = getNanoClient();
  // Keep the exact anime-style enhancement that was used with Horde
  const enhancedPrompt = prompt + ', high quality anime style digital art, highly detailed';

  const response = await client.images.generate({
    // If no model provided, let NanoGPT use its default (or whatever your subscription roster allows)
    ...(model ? { model } : {}),
    prompt: enhancedPrompt,
    n: 1,
    size: '1024x1024',
    response_format: 'b64_json',
  });

  const data = response.data;
  if (!data || !data[0]) {
    throw new Error('NanoGPT did not return image data');
  }
  const b64 = data[0].b64_json;
  if (!b64) {
    throw new Error('NanoGPT did not return image data (b64_json)');
  }

  return Buffer.from(b64, 'base64');
}
