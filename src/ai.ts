// @ts-ignore - Bypass ESM/CommonJS restriction since the SDK natively supports both
import { GoogleGenAI } from '@google/genai';

const MODELS_TO_TRY = [
  'gemini-2.5-flash',
  'gemini-3.1-flash-lite',
  'gemma-4-31b-it',
  'gemma-4-26b-a4b-it',
  'gemini-1.5-flash',
  'gemini-2.5-pro'
];

export async function generateContentWithFallback(prompt: string | any[], tools?: any[]) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  for (const model of MODELS_TO_TRY) {
    try {
      const options: any = { model, contents: prompt };
      if (tools && tools.length > 0) {
        options.tools = tools;
      }
      const response = await ai.models.generateContent(options);
      return response;
    } catch (e: any) {
      console.log(`[⚠️] Model ${model} failed (${e.status || e.message || 'unknown error'}). Falling back...`);
      // If we are on the very last model and it still fails, throw the error
      if (model === MODELS_TO_TRY[MODELS_TO_TRY.length - 1]) {
        throw e;
      }
    }
  }
  throw new Error("All fallback models failed.");
}
