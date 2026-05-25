// @ts-ignore - Bypass ESM/CommonJS restriction since the SDK natively supports both
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

interface ModelConfig {
  id: string;
  provider: "gemini" | "openrouter";
}

let currentModel: ModelConfig = { id: "gemma-4-31b-it", provider: "gemini" };

const DEEPSEEK_V4_OPENROUTER_MODELS: Record<string, { reasoningEffort: "high" | "xhigh" }> = {
  "deepseek/deepseek-v4-flash": { reasoningEffort: "high" },
  "deepseek/deepseek-v4-flash:free": { reasoningEffort: "high" },
  "deepseek/deepseek-v4-pro": { reasoningEffort: "xhigh" },
};

const OPENROUTER_MODEL_ALIASES: Record<string, string> = {
  "deepseek-v4-flash": "deepseek/deepseek-v4-flash",
  "deepseek-4-flash": "deepseek/deepseek-v4-flash",
  "deepseek-v4-flash-free": "deepseek/deepseek-v4-flash:free",
  "deepseek-v4-pro": "deepseek/deepseek-v4-pro",
  "deepseek-4-pro": "deepseek/deepseek-v4-pro",
};

const OPENROUTER_DEEPSEEK_SERVER_TOOLS = [
  { type: "openrouter:web_search", parameters: { max_results: 5 } },
  { type: "openrouter:datetime" },
  { type: "openrouter:web_fetch" },
];

const GEMMA_4_DEFAULT_TOOLS = [{ googleSearch: {} }];

const FALLBACK_MODELS: ModelConfig[] = [
  { id: "gemini-2.5-flash", provider: "gemini" },
  { id: "gemini-3.1-flash-lite-preview", provider: "gemini" },
  { id: "gemma-4-31b-it", provider: "gemini" },
  { id: "gemma-4-26b-a4b-it", provider: "gemini" },
  { id: "gemini-1.5-flash", provider: "gemini" },
  { id: "gemini-2.5-pro", provider: "gemini" },
];

export function switchModel(id: string, provider: "gemini" | "openrouter") {
  const resolvedId = provider === "openrouter" ? (OPENROUTER_MODEL_ALIASES[id] || id) : id;
  currentModel = { id: resolvedId, provider };
  return `Switched to **${resolvedId}** (${provider})`;
}

export function getCurrentModel() {
  return currentModel;
}

export const TASK_MODELS: ModelConfig[] = [
  { id: "gemma-4-31b-it", provider: "gemini" },
  { id: "gemma-4-26b-a4b-it", provider: "gemini" }
];

function getDeepSeekV4OpenRouterConfig(modelId: string) {
  return DEEPSEEK_V4_OPENROUTER_MODELS[modelId];
}

function getOpenRouterTools(modelId: string, tools?: any[]) {
  const openRouterTools = (tools || []).filter((tool) => tool?.type === "function" || tool?.type?.startsWith?.("openrouter:"));
  const deepSeekConfig = getDeepSeekV4OpenRouterConfig(modelId);

  if (!deepSeekConfig) {
    return openRouterTools;
  }

  const existingToolTypes = new Set(openRouterTools.map((tool) => tool.type));
  const missingServerTools = OPENROUTER_DEEPSEEK_SERVER_TOOLS.filter((tool) => !existingToolTypes.has(tool.type));

  return [...openRouterTools, ...missingServerTools];
}

function isGemma4Model(modelId: string) {
  return modelId.startsWith("gemma-4-");
}

function getGeminiTools(modelId: string, tools: any[] | undefined, isDefaultConversationRequest: boolean) {
  if (!isDefaultConversationRequest || !isGemma4Model(modelId)) {
    return tools || [];
  }

  const geminiTools = [...(tools || [])];
  const hasGoogleSearch = geminiTools.some((tool) => "googleSearch" in tool);

  if (!hasGoogleSearch) {
    geminiTools.push(...GEMMA_4_DEFAULT_TOOLS);
  }

  return geminiTools;
}

export async function generateContentWithFallback(
  prompt: string | any[],
  tools?: any[],
  preferredModels?: ModelConfig[]
) {
  const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY || "dummy-key-to-prevent-crash",
  });

  const config = {
    temperature: 1.2,
  };
  const isDefaultConversationRequest = !preferredModels || preferredModels.length === 0;

  // Determine the sequence of models to try
  let modelsToTry: ModelConfig[];
  
  if (preferredModels && preferredModels.length > 0) {
    // If preferred models are given, try them first, then the standard ones
    const preferredIds = new Set(preferredModels.map(m => m.id));
    modelsToTry = [
      ...preferredModels,
      ...FALLBACK_MODELS.filter(m => !preferredIds.has(m.id))
    ];
  } else {
    // Standard behavior: current conversational model first
    modelsToTry = [
      currentModel,
      ...FALLBACK_MODELS.filter((m) => m.id !== currentModel.id),
    ];
  }

  for (const modelConfig of modelsToTry) {
    try {
      if (modelConfig.provider === "gemini") {
        const options: any = {
          model: modelConfig.id,
          config,
          contents: prompt,
        };
        const geminiTools = getGeminiTools(modelConfig.id, tools, isDefaultConversationRequest);
        if (geminiTools.length > 0) {
          options.tools = geminiTools;
        }
        const response = await gemini.models.generateContent(options);
        return { text: response.text };
      } else if (modelConfig.provider === "openrouter") {
        const deepSeekConfig = getDeepSeekV4OpenRouterConfig(modelConfig.id);
        let messages: any[] = [];

        if (typeof prompt === "string") {
          messages = [{ role: "user", content: prompt }];
        } else if (Array.isArray(prompt)) {
          const content = prompt.map((part) => {
            if (part.text) {
              return { type: "text", text: part.text };
            } else if (part.inlineData) {
              return {
                type: "image_url",
                image_url: {
                  url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
                },
              };
            }
            return { type: "text", text: JSON.stringify(part) };
          });
          messages = [{ role: "user", content }];
        }

        const options: any = {
          model: modelConfig.id,
          messages,
          temperature: config.temperature,
        };

        if (deepSeekConfig) {
          options.reasoning = { effort: deepSeekConfig.reasoningEffort };
          options.tool_choice = "auto";
          options.parallel_tool_calls = true;
        }

        const openRouterTools = getOpenRouterTools(modelConfig.id, tools);
        if (openRouterTools.length > 0) {
          options.tools = openRouterTools;
        }

        const response = await openai.chat.completions.create(options);
        return { text: response.choices[0]?.message?.content || "" };
      }
    } catch (e: any) {
      console.log(
        `[⚠️] Model ${modelConfig.id} (${modelConfig.provider}) failed (${e.status || e.message || "unknown error"}). Falling back...`,
      );
      // If we are on the very last model and it still fails, throw the error
      if (modelConfig === modelsToTry[modelsToTry.length - 1]) {
        throw e;
      }
    }
  }
  throw new Error("All fallback models failed.");
}
