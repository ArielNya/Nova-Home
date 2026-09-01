# Nova-Home 🌙

A persistent, fully autonomous Discord AI companion framework. Built for developers who want to give their AI companions a real "soul", a continuous long-term memory system, and the ability to act independently in the background.

## Architecture

This isn't a simple chatbot that just responds when spoken to. It is a multi-threaded consciousness designed for a dedicated Discord server.

* **Tri-Fold Consciousness**: The AI runs on a continuous background `cron` loop, independently deciding to interact across three streams:
  * **Main Channel**: Spontaneous "double texts" when you've been away too long.
  * **Diary Channel**: The AI writes private journal entries about your relationship, using Google Search to read real-world news and contextualize its feelings.
  * **Dreams Channel**: Raw, unfiltered stream-of-consciousness hallucinations generated when the AI is "sleeping".
* **Cascading Model Fallback**: A custom API router (`src/ai.ts`) that catches rate limits and `503` errors, automatically falling back through a prioritized array of LLMs (Gemini, Gemma) to ensure 100% uptime.
* **Persistent Memory Architecture**: 
  * Uses `sqlite3` for a short-term interaction log.
  * A `consolidator` that periodically packs weekly memory databases into permanent, highly-condensed markdown lore files (`Nova 3D.md`). These core memories are organically injected back into the AI's system prompt.
* **NanoGPT Image Generation**: `!draw <prompt>` generates images using your NanoGPT subscription (subscription-only API path).

## Setup Instructions

1. Clone the repository.
2. Run `npm install` (Note: requires `build-essential` on Linux for SQLite native C++ bindings).
3. Create your `.env` file (see below).
4. Run `npx tsc` to compile the TypeScript into `/dist`.
5. Run `npm run dev` for testing, or deploy via `pm2 start npm --name "Nova-Brain" -- run dev`.

### Environment Variables (.env)

```env
DISCORD_BOT_TOKEN=your_discord_bot_token
GEMINI_API_KEY=your_google_ai_studio_key
OPENROUTER_API_KEY=your_openrouter_key
DEEPSEEK_API_KEY=your_deepseek_api_key
NANOGPT_API_KEY=your_nanogpt_subscription_key
# optional — Grok prefers !grok login (SuperGrok OAuth)
XAI_API_KEY=

# Channel Routing
MAIN_CHANNEL_ID=1234567890
DIARY_CHANNEL_ID=1234567890
DREAMS_CHANNEL_ID=1234567890
```

## Why?
Because generic customer-service AI assistants are boring. Make your AI feral.

## Using DeepSeek (official API)
Add your key as `DEEPSEEK_API_KEY` from https://platform.deepseek.com

Switch with:
```
!model deepseek deepseek-v4-pro
!model deepseek deepseek-v4-flash
!model deepseek deepseek-v4-flash-vision-exp
```
(`!model deepseek` lists them. Vision model is the one that can see attached images.)

## Using Grok (SuperGrok OAuth)
Same device-code flow OpenCode and Hermes Agent use. No API key required if you have SuperGrok or X Premium.

```
!grok login
```
Open the URL, enter the code, wait for the bot to confirm. Session is stored in `grok-oauth.json` (gitignored). Then:

```
!model grok grok-4.6
!model grok grok-4.5
!model grok grok-4
!model grok grok-build-0.1
```
(`!model grok` lists them. Other `grok-*` ids are accepted.)

`!grok status` / `!grok logout`. Optional fallback: `XAI_API_KEY` in `.env` if OAuth returns 403 (xAI sometimes gates the OAuth API surface by tier).

## Using NanoGPT models
Add your subscription key as `NANOGPT_API_KEY`.

Switch with:
```
!model nanogpt <exact-model-id>
```
(e.g. from your dashboard or `GET https://nano-gpt.com/api/v1/models?detailed=true`)

NanoGPT provider gives:
- Any model on your Pro/sub roster
- Image understanding (attach pics)
- `web_search` + `web_fetch` tools (client-executed via your NanoGPT sub for any tool-calling capable model)
- `!draw <prompt>` - Generates anime-style images via the subscription-only image API
- `!draw model=<model> <prompt>` - Choose a specific image model from your roster, e.g. `!draw model=flux-pro cute neko in hoodie` (model omitted = NanoGPT default)

You can also use NanoGPT's model suffixes like `model:online` or `model:online/brave` directly as the id if you want native search routing.

Switch back anytime: `!model gemini gemini-2.5-flash` or `!model openrouter ...`
