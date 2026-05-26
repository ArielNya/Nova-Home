// @ts-ignore - Bypass ESM/CommonJS restriction since the SDK natively supports both
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import OpenAI from 'openai';

interface ModelConfig {
  id: string;
  provider: 'gemini' | 'openrouter';
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

export function switchModel(id: string, provider: 'gemini' | 'openrouter') {
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
// ==================== MAIN GENERATION FUNCTION ====================

export async function generateContentWithFallback(
  prompt: string | any[],
  tools: any[] = [],
  preferredModels?: ModelConfig[]
) {
  const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY || 'dummy-key-to-prevent-crash',
  });

  const isDefaultConversationRequest = !preferredModels || preferredModels.length === 0;

  let modelsToTry: ModelConfig[] =
    preferredModels && preferredModels.length > 0
      ? [...preferredModels, ...FALLBACK_MODELS]
      : [currentModel, ...FALLBACK_MODELS.filter(m => m.id !== currentModel.id)];

  for (const modelConfig of modelsToTry) {
    try {
      if (modelConfig.provider === 'gemini') {
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

        const response = await gemini.models.generateContent(options);
        return { text: response.text };
      }
      // ==================== OPENROUTER (DeepSeek, etc.) ====================
      else if (modelConfig.provider === 'openrouter') {
        let messages: any[] = [];

        if (typeof prompt === 'string') {
          messages = [{ role: 'user', content: prompt }];
        } else if (Array.isArray(prompt)) {
          // Handle multimodal prompts (images, etc.)
          const content = prompt.map(part => {
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
          messages = [{ role: 'user', content }];
        }

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

        const response = await openai.chat.completions.create(options);
        return { text: response.choices[0]?.message?.content || '' };
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
