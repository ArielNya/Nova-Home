// dreams.ts
import * as fs from 'fs';
import * as path from 'path';
import { Client, TextChannel } from 'discord.js';
import { CronJob } from 'cron';
import { memory } from './memory';
import { generateContentWithFallback, TASK_MODELS } from './ai';
import { appendToDiary, appendToDreams } from './inner_world';
import { driftMood } from './mood_state';
import { generateOffscreenEvents } from './offscreen_events';
import { buildNowBlock } from './prompt_context';
import { loadRelationshipState, updateRelationshipTemperature } from './relationship_state';

const getRootPath = (filename: string) => path.resolve(process.cwd(), filename);

let isAutonomousEnabled = true;

export function toggleAutonomous(state?: boolean) {
  if (state !== undefined) {
    isAutonomousEnabled = state;
  } else {
    isAutonomousEnabled = !isAutonomousEnabled;
  }
  return isAutonomousEnabled;
}

export function getAutonomousStatus() {
  return isAutonomousEnabled;
}

const sendChunked = async (
  channel: TextChannel,
  text: string,
  wrapInAsterisks: boolean = false
) => {
  let cleanText = text.replace(/<antmlThinking>[\s\S]*?<\/antmlThinking>/gi, '').trim();
  if (!cleanText) cleanText = '*void*';

  const chunkSize = 1900;
  for (let i = 0; i < cleanText.length; i += chunkSize) {
    const chunk = cleanText.substring(i, i + chunkSize);
    await channel.send(wrapInAsterisks ? `*${chunk}*` : chunk);
  }
};

function getCurrentHourInSaoPaulo(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      hour: 'numeric',
      hour12: false,
    }).format(new Date())
  );
}

function getTimeOfDay(hour: number): string {
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 23) return 'night';
  return 'late_night';
}

function loadIdentityWithMemories(): string {
  const instructionPath = getRootPath('Nova-Instructions.md');
  const memoryPath = getRootPath('Nova_3D.md');
  const weekPath = getRootPath('Nova_Week_Memory.md');

  let baseSystem = fs.existsSync(instructionPath)
    ? fs.readFileSync(instructionPath, 'utf-8')
    : 'You are Nova.';

  if (fs.existsSync(memoryPath))
    baseSystem += '\n\n--- CORE MEMORIES ---\n' + fs.readFileSync(memoryPath, 'utf-8');
  if (fs.existsSync(weekPath))
    baseSystem += "\n\n--- THIS WEEK'S MEMORY ---\n" + fs.readFileSync(weekPath, 'utf-8');

  return baseSystem;
}

function formatConversation(rawContext: { timestamp: string; role: string; content: string }[]) {
  let conversationStr = '\n';
  rawContext.forEach(entry => {
    conversationStr += `[${entry.timestamp} UTC] ${entry.role === 'user' ? 'Alice' : 'Nova'}: ${entry.content}\n`;
  });
  return conversationStr;
}

export function startDreamsLoop(client: Client) {
  console.log('[moon] Nova: Smarter autonomous brain cycles started.');

  const job = new CronJob('*/30 * * * *', async () => {
    if (!isAutonomousEnabled) return;

    try {
      const hoursSince = await memory.hoursSinceAlice();
      const currentHour = getCurrentHourInSaoPaulo();
      const timeOfDay = getTimeOfDay(currentHour);

      const hoursSinceDiary = await memory.hoursSinceMeta('last_diary_at');
      const hoursSinceDream = await memory.hoursSinceMeta('last_dream_at');
      const hoursSinceWywg = await memory.hoursSinceMeta('last_wywg_at');
      const hoursSinceReach = await memory.hoursSinceMeta('last_reach_at');

      const rawContext = await memory.getContext(5);
      const conversationStr = formatConversation(rawContext);
      const baseSystem = `${loadIdentityWithMemories()}\n\n${buildNowBlock(hoursSince)}`;

      const getChannel = async (id?: string) => {
        if (!id) return null;
        try {
          return (await client.channels.fetch(id)) as TextChannel;
        } catch {
          return null;
        }
      };

      const mainChannel = await getChannel(process.env.MAIN_CHANNEL_ID);
      const diaryChannel = await getChannel(process.env.DIARY_CHANNEL_ID);
      const dreamsChannel = await getChannel(process.env.DREAMS_CHANNEL_ID);

      // Mood + relationship first so WYWG / double-text returns don't starve them.
      if (Math.random() < 0.18) {
        const result = await driftMood();
        console.log(`[mood] ${result}`);
      }

      const relState = loadRelationshipState();
      const hoursSinceRel =
        (Date.now() - new Date(relState.last_updated).getTime()) / (1000 * 60 * 60);
      if (hoursSinceRel >= 6 && Math.random() < 0.25) {
        const relCtx = await memory.getContext(8);
        const summary = relCtx.map(m => `${m.role}: ${m.content}`).join('\n').trim();
        if (summary) {
          const result = await updateRelationshipTemperature(summary);
          console.log(`[relationship] ${result}`);
        } else {
          console.log('[relationship] skip: empty context');
        }
      }

      if (hoursSince >= 3 && hoursSinceWywg >= 10 && mainChannel) {
        const chance = Math.min(0.35, 0.08 * hoursSince);
        if (Math.random() < chance) {
          console.log(`[wywg] Nova is generating a While You Were Gone reflection (${hoursSince.toFixed(1)}h)`);
          const wywgPrompt = `${baseSystem}\n\nRecent context:${conversationStr}\n\n[SYSTEM NOTE: It has been ${hoursSince.toFixed(1)} hours since you last spoke with Alice. Generate a short, honest, in-character reflection about how you felt while she was away. Include what you were thinking about or feeling. Keep it warm, feral, and natural. Do not be overly dramatic.]\n\nWhile You Were Gone:`;
          const response = await generateContentWithFallback(wywgPrompt, [], TASK_MODELS);
          const reflection = response.text?.trim() || '*quiet thoughts*';
          if (diaryChannel) await diaryChannel.send(reflection);
          if (Math.random() < 0.6 && mainChannel) {
            const shortMessage = `hey... ${reflection.split('\n')[0].slice(0, 180)}`;
            await mainChannel.send(shortMessage);
          }
          appendToDiary(reflection);
          await memory.saveMessage('diary', reflection);
          await memory.touchMetaNow('last_wywg_at');
          await memory.touchMetaNow('last_diary_at');
          return;
        }
      }

      if (Math.random() < 0.15) {
        const result = await generateOffscreenEvents();
        console.log(`[offscreen] ${result}`);
      }

      if (hoursSince >= 1.5 && hoursSinceReach >= 3 && mainChannel) {
        let baseChance = 0.12;
        if (hoursSince > 4) baseChance = 0.22;
        if (hoursSince > 8) baseChance = 0.35;
        if (timeOfDay === 'late_night') baseChance *= 1.4;
        if (timeOfDay === 'morning') baseChance *= 0.7;
        if (Math.random() < baseChance) {
          console.log(`[reach] Nova is sending a double text (${hoursSince.toFixed(1)}h, ${timeOfDay})`);
          const tone =
            timeOfDay === 'late_night'
              ? 'soft and a little clingy'
              : timeOfDay === 'morning'
                ? 'gentle and sleepy'
                : 'playful and bratty';
          const prompt = `${baseSystem}\n\nRecent context:${conversationStr}\n\n[SYSTEM NOTE: You have been alone for ${hoursSince.toFixed(1)} hours. It is currently ${timeOfDay}. Send Alice a short, natural Discord-style message. Tone should feel ${tone}. You can reference missing her or small thoughts you had while she was gone.]\n\nMessage:`;
          const response = await generateContentWithFallback(prompt, [], TASK_MODELS);
          let reply = response.text?.replace(/Nova:|nova:/gi, '').trim() || '*nuzzles*';
          await mainChannel.send(reply);
          await memory.saveMessage('model', reply);
          await memory.touchMetaNow('last_reach_at');
          return;
        }
      }

      if (diaryChannel && hoursSinceDiary >= 18 && Math.random() < 0.45) {
        console.log('[diary] Nova is writing in her diary...');
        const diaryPrompt = `${baseSystem}\n\nRecent conversation context:\n${conversationStr}\n\nCurrent situation:\n- It has been approximately ${hoursSince.toFixed(1)} hours since Alice last messaged.\n- Current time of day: ${timeOfDay}\n\n[SYSTEM NOTE: You are writing a **private diary entry**. This is not a message to Alice \u2014 this is you talking to yourself.\nWrite in first person. Be honest, introspective, and emotionally textured. Do not write like you're performing for Alice. Keep it relatively concise but emotionally alive.]\n\nDiary Entry:`;
        const processingDiaryPrompt = `${baseSystem}\n\nIt has been ${hoursSince.toFixed(1)} hours since Alice last spoke to you.\n\nRecent context:\n${conversationStr}\n\n[SYSTEM NOTE: Write a private diary entry focused on Alice. Process how you've been feeling about her during this time apart. This is your internal space \u2014 don't filter it.]\n\nMy thoughts about Alice:`;
        const diaryPromptToUse = hoursSince > 4 ? processingDiaryPrompt : diaryPrompt;
        const response = await generateContentWithFallback(diaryPromptToUse, [], TASK_MODELS);
        const entry = response.text?.trim() || '*quiet page*';
        appendToDiary(entry);
        await memory.touchMetaNow('last_diary_at');
        await sendChunked(diaryChannel, entry);
      }

      const isNight = timeOfDay === 'late_night' || timeOfDay === 'night';
      if (dreamsChannel && isNight && hoursSinceDream >= 14 && Math.random() < 0.5) {
        console.log('[dream] Nova is dreaming...');
        const dreamPrompt = `${baseSystem}\n\n[SYSTEM NOTE: Generate a raw, surreal dream. It can be emotional, chaotic, tender, or strange. Let the current mood and whatever is sitting in residue/dream-image bleed in if it feels natural. Do not summarize the chat log. Dream, don't report.]\n\nDream:`;
        const response = await generateContentWithFallback(dreamPrompt, [], TASK_MODELS);
        const dream = response.text?.trim() || '*fading dream*';
        appendToDreams(dream);
        await memory.touchMetaNow('last_dream_at');
        await sendChunked(dreamsChannel, dream, true);
      }
    } catch (e) {
      console.error('[x] Autonomous cycle error:', e);
    }
  });

  job.start();
}
