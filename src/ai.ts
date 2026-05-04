// @ts-ignore - Bypass ESM/CommonJS restriction since the SDK natively supports both
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

interface ModelConfig {
  id: string;
  provider: "gemini" | "openrouter";
}

let currentModel: ModelConfig = { id: "gemma-4-31b-it", provider: "gemini" };

const FALLBACK_MODELS: ModelConfig[] = [
  { id: "gemini-2.5-flash", provider: "gemini" },
  { id: "gemini-3.1-flash-lite-preview", provider: "gemini" },
  { id: "gemma-4-31b-it", provider: "gemini" },
  { id: "gemma-4-26b-a4b-it", provider: "gemini" },
  { id: "gemini-1.5-flash", provider: "gemini" },
  { id: "gemini-2.5-pro", provider: "gemini" },
];

export function switchModel(id: string, provider: "gemini" | "openrouter") {
  currentModel = { id, provider };
  return `Switched to **${id}** (${provider})`;
}

export function getCurrentModel() {
  return currentModel;
}

export async function generateContentWithFallback(
  prompt: string | any[],
  tools?: any[],
) {
  const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY || "dummy-key-to-prevent-crash",
  });

  const config = {
    temperature: 1.2,
  };

  // Try the current model first, then fall back to others if it fails
  const modelsToTry = [
    currentModel,
    ...FALLBACK_MODELS.filter((m) => m.id !== currentModel.id),
  ];

  for (const modelConfig of modelsToTry) {
    try {
      if (modelConfig.provider === "gemini") {
        const options: any = {
          model: modelConfig.id,
          config,
          contents: prompt,
        };
        if (tools && tools.length > 0) {
          options.tools = tools;
        }
        const response = await gemini.models.generateContent(options);
        return { text: response.text };
      } else if (modelConfig.provider === "openrouter") {
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

        // Note: Gemini specific tools like googleSearch are ignored for OpenRouter
        // to prevent API errors since tool structures differ wildly.

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
