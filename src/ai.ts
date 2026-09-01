// @ts-ignore - Bypass ESM/CommonJS restriction since the SDK natively supports both
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import {
  isNovaPrompt,
  flattenNovaPrompt,
  buildDeepSeekPayload,
  buildChatMessagesFromNovaPrompt,
  type NovaPrompt,
} from './prompt_shape';
import { getGrokAccessToken } from './grok_oauth';

export type PromptInput = string | any[] | NovaPrompt;

// Module-level NanoGPT client (subscription-only) for chat
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

// Separate client for image generation.
// NanoGPT uses https://nano-gpt.com/v1/images/generations for the OpenAI-compatible image API.
// Subscription-included models (like "chroma") are available when using your sub key here.
let nanoImageClient: OpenAI | null = null;

function getNanoImageClient() {
  if (!nanoImageClient) {
    nanoImageClient = new OpenAI({
      baseURL: 'https://nano-gpt.com/v1',
      apiKey: process.env.NANOGPT_API_KEY || 'dummy-key-to-prevent-crash',
    });
  }
  return nanoImageClient;
}

let deepseekClient: OpenAI | null = null;

function getDeepSeekClient() {
  if (!deepseekClient) {
    deepseekClient = new OpenAI({
      baseURL: 'https://api.deepseek.com',
      apiKey: process.env.DEEPSEEK_API_KEY || 'dummy-key-to-prevent-crash',
    });
  }
  return deepseekClient;
}

async function getGrokClient() {
  const apiKey = await getGrokAccessToken();
  return new OpenAI({
    baseURL: 'https://api.x.ai/v1',
    apiKey,
  });
}

export type Provider = 'gemini' | 'openrouter' | 'nanogpt' | 'deepseek' | 'grok';
export type ThinkLevel = 'off' | 'low' | 'high' | 'max';

interface ModelConfig {
  id: string;
  provider: Provider;
  /** Official DeepSeek only. Conversation uses the !think setting if omitted. */
  think?: ThinkLevel;
}

export const DEEPSEEK_MODELS = [
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-v4-flash-vision-exp',
] as const;

export const DEEPSEEK_VISION_MODEL = 'deepseek-v4-flash-vision-exp';

export const GROK_MODELS = ['grok-4.6', 'grok-4.5', 'grok-4', 'grok-build-0.1'] as const;

export function isGrokModelId(id: string): boolean {
  const s = id.trim();
  if (!s) return false;
  if ((GROK_MODELS as readonly string[]).includes(s)) return true;
  return /^grok[-.]/i.test(s);
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

export function switchModel(id: string, provider: Provider) {
  currentModel = { id, provider };
  return `Switched to **${id}** (${provider})`;
}

export function getCurrentModel() {
  return currentModel;
}

let deepseekThink: ThinkLevel = 'high';

const THINK_ALIASES: Record<string, ThinkLevel> = {
  off: 'off',
  none: 'off',
  disable: 'off',
  disabled: 'off',
  low: 'low',
  high: 'high',
  max: 'max',
};

export function getDeepSeekThink(): ThinkLevel {
  return deepseekThink;
}

export function setDeepSeekThink(level: string): string {
  const next = THINK_ALIASES[level.toLowerCase()];
  if (!next) {
    return `Thinking must be \`off\`, \`low\`, \`high\`, or \`max\`. Current: **${deepseekThink}**`;
  }
  deepseekThink = next;
  return next === 'off'
    ? 'DeepSeek thinking **disabled**.'
    : `DeepSeek reasoning effort set to **${next}**.`;
}

function deepseekThinkOptions(model: ModelConfig, isConversation: boolean) {
  const level = model.think ?? (isConversation ? deepseekThink : 'low');
  if (level === 'off') return { thinking: { type: 'disabled' as const } };
  return {
    thinking: { type: 'enabled' as const },
    reasoning_effort: level,
  };
}

/** Responses API reasoning.effort: none | low | high | max */
function deepseekReasoning(model: ModelConfig, isConversation: boolean) {
  const level = model.think ?? (isConversation ? deepseekThink : 'low');
  return { reasoning: { effort: level === 'off' ? 'none' : level } };
}

/** xAI grok-4.6/4.5: low | medium | high | xhigh. Cannot disable. */
function grokReasoning(model: ModelConfig, isConversation: boolean) {
  const level = model.think ?? (isConversation ? deepseekThink : 'low');
  const id = (model.id || '').toLowerCase();
  let effort = 'high';
  if (level === 'off' || level === 'low') effort = 'low';
  else if (level === 'max') effort = id.includes('4.6') ? 'xhigh' : 'high';
  return { reasoning: { effort } };
}

export const TASK_MODELS: ModelConfig[] = [
  { id: 'deepseek-v4-flash', provider: 'deepseek', think: 'low' },
  { id: 'gemma-4-31b-it', provider: 'gemini' },
  { id: 'gemma-4-26b-a4b-it', provider: 'gemini' },
];

/** Models love wrapping JSON in ```json fences. Pull out the object anyway. */
export function parseJsonFromLlm<T = any>(text: string): T {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new SyntaxError('No JSON object in LLM response');
  }
  return JSON.parse(text.slice(start, end + 1));
}

export function errDetail(e: unknown): string {
  const err = e as any;
  const status = err?.status ?? err?.response?.status ?? err?.code;
  const msg = err?.message || String(e);
  const nested =
    err?.error?.message ||
    err?.response?.data?.error?.message ||
    (typeof err?.error === 'string' ? err.error : '');
  const bits: string[] = [];
  if (status) bits.push(`status=${status}`);
  bits.push(msg);
  if (nested && nested !== msg) bits.push(nested);
  return bits.join(' | ');
}

function clip(s: string, n = 100): string {
  const t = String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

// ==================== TOOL HELPERS ====================

function getOpenRouterTools(tools: any[] = []) {
  // Always give OpenRouter models powerful web tools
  const serverTools = [...OPENROUTER_SERVER_TOOLS];

  // Merge with any user-provided tools, avoiding duplicates
  const existingTypes = new Set(tools.map(t => t.type));
  const finalTools = [...tools, ...serverTools.filter(t => !existingTypes.has(t.type))];

  return finalTools;
}

function getGeminiTools(tools: any[] | undefined) {
  // Don't auto-attach googleSearch on every Discord turn.
  return [...(tools || [])];
}

// ==================== NANOGPT WEB TOOLS (client-side, using your subscription) ====================
// These give ANY model on the NanoGPT roster (that supports tool calling) access to web search + fetch.

const WEB_SEARCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description:
      'Search the web for up-to-date information, news, facts, or current events. Always use this for anything time-sensitive or external knowledge.',
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
    description:
      'Fetch and read the main text content of a specific webpage URL. Use after web_search when you need the full details from a promising link.',
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
      return (
        `Search results for "${query}":\n` +
        data.data
          .map(
            (r: any, i: number) =>
              `${i + 1}. ${r.title || r.name || ''} — ${r.url || r.link || ''}\n   ${r.snippet || r.summary || r.content || ''}`
          )
          .join('\n')
      );
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
  const argHint =
    args?.query || args?.q || args?.who || args?.subject || args?.url || '';
  console.log(`[nova] tool ${name}${argHint ? ` (${clip(String(argHint), 80)})` : ''}`);

  if (name === 'recall_recent_inner_world' || name === 'recall_my_recent_inner_world') {
    const mod = await import('./inner_world.js');
    const out = mod.getFullRecentInnerWorld();
    console.log(`[nova] tool ${name} → ${String(out).length} chars`);
    return out;
  }
  if (name === 'recall_visual_canon' || name === 'recall_appearance') {
    const mod = await import('./appearance.js');
    const out = mod.getVisualCanon(args.who || args.subject || 'both');
    console.log(`[nova] tool ${name} who=${args.who || args.subject || 'both'} → ${out.length} chars`);
    return out;
  }
  if (name === 'web_search') {
    const out = await performWebSearch(args.query || args.q || '');
    console.log(`[nova] tool web_search → ${out.length} chars`);
    return out;
  }
  if (name === 'web_fetch') {
    const out = await performWebFetch(args.url || '');
    console.log(`[nova] tool web_fetch → ${out.length} chars`);
    return out;
  }
  console.warn(`[nova] unknown tool: ${name}`);
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

/** Flatten Gemini-style {name, description, parameters} into Responses API function tools. */
function convertToResponsesFunctionTools(tools: any[] = []): any[] {
  return tools
    .map(t => {
      if (t?.type === 'web_search' || t?.type === 'web_search_2025_08_26') {
        return { type: t.type };
      }
      const name = t?.function?.name || t?.name;
      if (!name) return null;
      return {
        type: 'function',
        name,
        description: t?.function?.description || t?.description || '',
        parameters: t?.function?.parameters || t?.parameters || { type: 'object', properties: {} },
      };
    })
    .filter(Boolean);
}

const DEEPSEEK_WEB_SEARCH_TOOL = { type: 'web_search' as const };

async function runOpenAIToolLoop(
  client: OpenAI,
  messages: any[],
  optionsBase: any
): Promise<string> {
  const MAX_ROUNDS = 4;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    console.log(
      `[nova] chat-completions round ${round + 1}/${MAX_ROUNDS}  model=${optionsBase.model}`
    );
    const resp = await client.chat.completions.create({
      ...optionsBase,
      messages,
    });

    const msg: any = resp.choices[0]?.message;
    if (!msg) {
      console.warn('[nova] chat-completions: empty message');
      break;
    }

    const toolCalls = msg.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const names = toolCalls.map((tc: any) => tc.function?.name || tc.name || '?').join(', ');
      console.log(`[nova] chat-completions wants tools: ${names}`);
      messages.push(msg);

      for (const tc of toolCalls) {
        const funcPart: any = tc.function || tc;
        const name = funcPart?.name || '';
        let args: any = {};
        try {
          args = funcPart?.arguments ? JSON.parse(funcPart.arguments) : {};
        } catch (e) {
          console.warn(`[nova] tool ${name}: bad args json`);
        }
        const resultText = await executeTool(name, args);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: String(resultText),
        });
      }
      continue;
    }

    const text = msg.content || '';
    if (!text.trim()) console.warn('[nova] chat-completions: empty text');
    return text;
  }
  console.warn('[nova] chat-completions: hit max rounds, no final text');
  return '';
}

function promptHasImages(p: PromptInput): boolean {
  if (isNovaPrompt(p)) return !!(p.images && p.images.length);
  if (!Array.isArray(p)) return false;
  return p.some(
    (part: any) =>
      part?.inlineData ||
      part?.type === 'image_url' ||
      part?.type === 'input_image' ||
      part?.image_url
  );
}

function buildResponsesInputFromPrompt(p: string | any[]): any[] {
  if (typeof p === 'string') {
    return [{ role: 'user', content: p }];
  }
  if (Array.isArray(p)) {
    const content = p.map(part => {
      if (part.text) return { type: 'input_text', text: part.text };
      if (part.inlineData) {
        return {
          type: 'input_image',
          image_url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
        };
      }
      return { type: 'input_text', text: JSON.stringify(part) };
    });
    return [{ role: 'user', content }];
  }
  return [{ role: 'user', content: '' }];
}

function resolveDeepSeekPayload(p: PromptInput): { instructions?: string; input: any[] } {
  if (isNovaPrompt(p)) return buildDeepSeekPayload(p);
  return { input: buildResponsesInputFromPrompt(p) };
}

function toGeminiContents(p: PromptInput): string | any[] {
  if (isNovaPrompt(p)) {
    const text = flattenNovaPrompt(p);
    const images = p.images || [];
    if (!images.length) return text;
    return [
      { text },
      ...images.map(img => ({
        inlineData: { mimeType: img.mimeType, data: img.data },
      })),
    ];
  }
  return p;
}

function toChatMessages(p: PromptInput): any[] {
  if (isNovaPrompt(p)) return buildChatMessagesFromNovaPrompt(p);
  return buildMessagesFromPrompt(p);
}

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

function extractResponsesText(resp: any): string {
  if (resp?.output_text) return String(resp.output_text);
  const parts: string[] = [];
  for (const item of resp?.output || []) {
    if (item?.type !== 'message') continue;
    for (const c of item.content || []) {
      if (typeof c?.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('\n');
}

function logResponsesUsage(resp: any, label: string) {
  const u = resp?.usage || {};
  const cached =
    u.input_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? u.cached_tokens ?? 0;
  const inTok = u.input_tokens ?? u.prompt_tokens ?? '?';
  const outTok = u.output_tokens ?? u.completion_tokens ?? '?';
  const think = u.output_tokens_details?.reasoning_tokens ?? u.reasoning_tokens;
  const thinkBit = think != null ? `  think=${think}` : '';
  console.log(`[nova] ${label} tokens  in=${inTok} cached=${cached} out=${outTok}${thinkBit}`);
}

async function runResponsesLoop(
  client: OpenAI,
  input: any[],
  tools: any[],
  optionsBase: any,
  label: string
): Promise<string> {
  const MAX_ROUNDS = 6;
  const toolNames = (tools || []).map((t: any) => t.name || t.type).join(', ') || 'none';
  const hasInstr = !!optionsBase.instructions;
  console.log(
    `[nova] ${label} responses  model=${optionsBase.model}  tools=${toolNames}  instructions=${hasInstr ? optionsBase.instructions.length + 'c' : 'no'}  input_items=${input.length}`
  );

  for (let round = 0; round < MAX_ROUNDS; round++) {
    console.log(`[nova] ${label} round ${round + 1}/${MAX_ROUNDS}`);
    const resp: any = await client.responses.create({
      ...optionsBase,
      input,
      tools: tools.length ? tools : undefined,
    });

    if (resp?.status === 'failed' || resp?.error) {
      throw new Error(resp?.error?.message || `${label} Responses status=failed`);
    }

    logResponsesUsage(resp, label);

    const output: any[] = Array.isArray(resp?.output) ? resp.output : [];
    const types = output.map((i: any) => i?.type || '?').join(', ') || 'none';
    console.log(`[nova] ${label} status=${resp?.status || '?'}  output=[${types}]`);

    for (const item of output) {
      if (item?.type === 'web_search_call') {
        const q = item.action?.query || item.query || '';
        console.log(`[nova] ${label} web_search${q ? ': ' + clip(String(q), 120) : ''}`);
      }
    }

    const functionCalls = output.filter((i: any) => i?.type === 'function_call');
    if (!functionCalls.length) {
      const text = extractResponsesText(resp);
      if (!text.trim()) {
        console.warn(`[nova] ${label} responses: empty reply`);
      } else {
        console.log(`[nova] ${label} done  ${text.length} chars`);
      }
      return text;
    }

    console.log(
      `[nova] ${label} wants functions: ${functionCalls.map((fc: any) => fc.name || '?').join(', ')}`
    );
    input.push(...output);
    for (const fc of functionCalls) {
      let args: any = {};
      try {
        args = fc.arguments ? JSON.parse(fc.arguments) : {};
      } catch {
        console.warn(`[nova] tool ${fc.name}: bad args json`);
      }
      const resultText = await executeTool(fc.name || '', args);
      input.push({
        type: 'function_call_output',
        call_id: fc.call_id,
        output: String(resultText),
      });
    }
  }
  console.warn(`[nova] ${label} responses: hit max rounds, no final text`);
  return '';
}

// ==================== MAIN GENERATION FUNCTION ====================

export async function generateContentWithFallback(
  prompt: PromptInput,
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

  const first = modelsToTry[0];
  const histHint = isNovaPrompt(prompt) ? `  history=${prompt.history.length}` : '';
  console.log(
    `[nova] gen ${isDefaultConversationRequest ? 'chat' : 'task'}  first=${first.provider}/${first.id}  images=${promptHasImages(prompt)}  tools=${(tools || []).map((t: any) => t.name || t.type).join(',') || 'none'}${histHint}`
  );

  for (const modelConfig of modelsToTry) {
    try {
      console.log(`[nova] trying ${modelConfig.provider}/${modelConfig.id}`);
      if (modelConfig.provider === 'gemini') {
        const g = getGemini();
        const geminiTools = getGeminiTools(tools);

        const geminiConfig: any = {
          temperature: 1.2,
          tools: geminiTools.length > 0 ? geminiTools : undefined,
        };

        const options: any = {
          model: modelConfig.id,
          config: geminiConfig,
          contents: toGeminiContents(prompt),
        };

        const response = await g.models.generateContent(options);
        const text = response.text || '';
        console.log(`[nova] ok gemini/${modelConfig.id}  ${text.length} chars`);
        return { text };
      }

      // ==================== OPENROUTER (DeepSeek, etc. — keep server tools behavior) ====================
      else if (modelConfig.provider === 'openrouter') {
        const client = getORClient();
        const messages = toChatMessages(prompt);
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
        const text = response.choices[0]?.message?.content || '';
        console.log(`[nova] ok openrouter/${modelConfig.id}  ${text.length} chars`);
        return { text };
      }

      // ==================== NANOGPT (any model from your Pro/sub roster) ====================
      else if (modelConfig.provider === 'nanogpt') {
        const client = getNanoClient();
        const messages = toChatMessages(prompt);
        const nanoTools = [...convertToStandardTools(tools), ...NANO_GPT_WEB_TOOLS];

        const text = await runOpenAIToolLoop(client, messages, {
          model: modelConfig.id,
          temperature: 1.2,
          tools: nanoTools.length > 0 ? nanoTools : undefined,
        });
        console.log(`[nova] ok nanogpt/${modelConfig.id}  ${text.length} chars`);
        return { text };
      }

      // ==================== DEEPSEEK (official API — Responses + native web_search) ====================
      else if (modelConfig.provider === 'deepseek') {
        const client = getDeepSeekClient();
        const functionTools = convertToResponsesFunctionTools(tools);
        const deepseekTools = isDefaultConversationRequest
          ? [...functionTools, DEEPSEEK_WEB_SEARCH_TOOL]
          : functionTools;

        const modelId =
          isDefaultConversationRequest && promptHasImages(prompt)
            ? DEEPSEEK_VISION_MODEL
            : modelConfig.id;
        if (modelId !== modelConfig.id) {
          console.log(`[nova] vision: image attached, using ${modelId} (default stays ${modelConfig.id})`);
        }

        const { instructions, input } = resolveDeepSeekPayload(prompt);

        try {
          const text = await runResponsesLoop(client, input, deepseekTools, {
            model: modelId,
            temperature: 1.2,
            instructions: instructions || undefined,
            ...deepseekReasoning(modelConfig, isDefaultConversationRequest),
          }, 'deepseek');
          console.log(`[nova] ok deepseek/${modelId}  ${text.length} chars`);
          return { text };
        } catch (e: any) {
          console.warn(
            `[nova] deepseek responses failed (${errDetail(e)}) — retrying chat completions, no native web_search`
          );
          const messages = toChatMessages(prompt);
          const chatTools = convertToStandardTools(tools);
          const text = await runOpenAIToolLoop(client, messages, {
            model: modelId,
            tools: chatTools.length > 0 ? chatTools : undefined,
            ...deepseekThinkOptions(modelConfig, isDefaultConversationRequest),
          });
          console.log(`[nova] ok deepseek/${modelId} via chat-completions  ${text.length} chars`);
          return { text };
        }
      }

      // ==================== GROK (xAI — SuperGrok OAuth or XAI_API_KEY) ====================
      else if (modelConfig.provider === 'grok') {
        const client = await getGrokClient();
        const functionTools = convertToResponsesFunctionTools(tools);
        const grokTools = isDefaultConversationRequest
          ? [...functionTools, DEEPSEEK_WEB_SEARCH_TOOL]
          : functionTools;
        const { instructions, input } = resolveDeepSeekPayload(prompt);

        try {
          const text = await runResponsesLoop(
            client,
            input,
            grokTools,
            {
              model: modelConfig.id,
              temperature: 1.2,
              instructions: instructions || undefined,
              ...grokReasoning(modelConfig, isDefaultConversationRequest),
            },
            'grok'
          );
          console.log(`[nova] ok grok/${modelConfig.id}  ${text.length} chars`);
          return { text };
        } catch (e: any) {
          const detail = errDetail(e);
          if (/\b403\b/.test(detail)) {
            console.warn(
              '[nova] grok 403 — SuperGrok OAuth may be tier-gated. Set XAI_API_KEY as fallback.'
            );
            throw e;
          }
          console.warn(`[nova] grok responses failed (${detail}) — retrying chat completions`);
          const messages = toChatMessages(prompt);
          const chatTools = convertToStandardTools(tools);
          const grokEffort = grokReasoning(modelConfig, isDefaultConversationRequest).reasoning.effort;
          const text = await runOpenAIToolLoop(client, messages, {
            model: modelConfig.id,
            tools: chatTools.length > 0 ? chatTools : undefined,
            reasoning_effort: grokEffort,
          });
          console.log(`[nova] ok grok/${modelConfig.id} via chat-completions  ${text.length} chars`);
          return { text };
        }
      }
    } catch (e: any) {
      console.warn(`[nova] ${modelConfig.provider}/${modelConfig.id} failed: ${errDetail(e)}`);
      if (modelConfig === modelsToTry[modelsToTry.length - 1]) throw e;
    }
  }

  throw new Error('All fallback models failed.');
}

// ==================== NANOGPT IMAGE GENERATION (replaces AI Horde) ====================
// Uses the subscription-only path so only roster-included image models are available.
// Always returns a Buffer (b64_json) so handler can attach directly.

export async function generateImage(prompt: string, model?: string): Promise<Buffer> {
  const client = getNanoImageClient();
  // Keep the exact anime-style enhancement that was used with Horde
  const enhancedPrompt = prompt + ', high quality anime style digital art, highly detailed';

  const response = await client.images.generate({
    // model from your subscription roster, e.g. "chroma", "hidream", "flux-pro" etc.
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
