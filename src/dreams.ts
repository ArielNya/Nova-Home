// dreams.ts
/*
import { Client, TextChannel } from 'discord.js';

import { CronJob } from 'cron';
import { memory } from './memory';
import { generateContentWithFallback, TASK_MODELS } from './ai';
import { getRelationshipContextForPrompt } from './relationship_state';
import { getMoodContextForPrompt } from './mood_state';
*/
import * as fs from 'fs';
import * as path from 'path';
import { Client, TextChannel } from 'discord.js';
import { CronJob } from 'cron';
import { memory } from './memory';
import { generateContentWithFallback, TASK_MODELS } from './ai';
import { 
  appendToDiary, 
  appendToDreams, 
  getRecentDiaryEntries, 
  getRecentDreamEntries 
} from './inner_world';
import { getMoodContextForPrompt } from './mood_state';
import { getRelationshipContextForPrompt } from './relationship_state';
import { driftMood } from './mood_state';   // if you have driftMood exported
import { generateOffscreenEvents, getRecentOffscreenEvents } from './offscreen_events';

const getRootPath = (filename: string) => path.resolve(process.cwd(), filename);
const instructionPath = getRootPath('Nova-Instructions.md');


let systemInstruction = fs.existsSync(instructionPath) 
  ? fs.readFileSync(instructionPath, 'utf-8') 
  : "You are Nova.";

systemInstruction += getMoodContextForPrompt();
systemInstruction += getRelationshipContextForPrompt();

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

// ==================== TIME HELPERS ====================

function getCurrentHourInSaoPaulo(): number {
  return new Date().getHours(); // Oracle VM is likely set to UTC, but we treat it as São Paulo time context
}

function getTimeOfDay(hour: number): string {
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 23) return 'night';
  return 'late_night';
}

function getHoursSinceLastInteraction(lastTimestamp: string | null): number {
  if (!lastTimestamp) return 999;
  const lastTime = parseInt(lastTimestamp, 10);
  return (Date.now() - lastTime) / (1000 * 60 * 60);
}

// ==================== MAIN AUTONOMOUS LOOP ====================

export function startDreamsLoop(client: Client) {
  console.log('[🌙] Nova: Smarter autonomous brain cycles started.');

  const job = new CronJob('*/30 * * * *', async () => {
    if (!isAutonomousEnabled) return;

    try {
      const getRootPath = (filename: string) => path.resolve(process.cwd(), filename);

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

      const rawContext = await memory.getContext(10);
      let conversationStr = '\n';
      rawContext.forEach(entry => {
        conversationStr += `[${entry.timestamp} UTC] ${entry.role === 'user' ? 'Alice' : 'Nova'}: ${entry.content}\n`;
      });

      const lastInteractionStr = await memory.getMeta('last_interaction');
      const hoursSince = getHoursSinceLastInteraction(lastInteractionStr);
      const currentHour = getCurrentHourInSaoPaulo();
      const timeOfDay = getTimeOfDay(currentHour);

      // Fetch channels
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

      // ==================== AUTONOMOUS DECISION LOGIC ====================

      // 1. WHILE YOU WERE GONE (Highest priority when she's been alone a while)
      if (hoursSince >= 3 && mainChannel) {
        const chance = Math.min(0.35, 0.08 * hoursSince); // scales with time gone

        if (Math.random() < chance) {
          console.log(
            `[💭] Nova is generating a "While You Were Gone" reflection (${hoursSince.toFixed(1)}h)`
          );

          const wywgPrompt = `${baseSystem}\n\nRecent context:${conversationStr}\n\n[SYSTEM NOTE: It has been ${hoursSince.toFixed(1)} hours since you last spoke with Alice. Generate a short, honest, in-character reflection about how you felt while she was away. Include what you were thinking about or feeling. Keep it warm, feral, and natural. Do not be overly dramatic.]\n\nWhile You Were Gone:`;

          const response = await generateContentWithFallback(wywgPrompt, [], TASK_MODELS);
          const reflection = response.text?.trim() || '*quiet thoughts*';

          // Send to Diary + optionally to main as a soft message
          if (diaryChannel) {
            await diaryChannel.send(reflection);
          }

          // Sometimes also send a shorter version to main
          if (Math.random() < 0.6 && mainChannel) {
            const shortMessage = `hey... ${reflection.split('\n')[0].slice(0, 180)}`;
            await mainChannel.send(shortMessage);
          }

          await memory.saveMessage('diary', reflection);
          return; // Prioritize this over other actions
        }
      }

      // Generate offscreen events once per day
      if (Math.random() < 0.15) {
        // ~once every ~3 hours on average, but we control it inside the function
        const result = await generateOffscreenEvents();
        console.log(`[🌫️] ${result}`);
      }
      // 2. DOUBLE TEXT / REACH OUT (time + mood aware)
      if (hoursSince >= 1.5 && mainChannel) {
        let baseChance = 0.12;

        // Increase chance the longer she's been alone
        if (hoursSince > 4) baseChance = 0.22;
        if (hoursSince > 8) baseChance = 0.35;

        // Time of day modulation
        if (timeOfDay === 'late_night') baseChance *= 1.4; // more likely to reach out late
        if (timeOfDay === 'morning') baseChance *= 0.7;

        if (Math.random() < baseChance) {
          console.log(
            `[📬] Nova is sending a double text (${hoursSince.toFixed(1)}h, ${timeOfDay})`
          );

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
          return;
        }
      }
      // Occasionally drift mood (roughly once every 6–12 hours on average)
      if (Math.random() < 0.08) {
        const result = await driftMood();
        console.log(`[🌡️] ${result}`);
      }
      // ==================== DIARY ====================
      if (diaryChannel && Math.random() < 0.12) {
        console.log('[📓] Nova is writing in her diary...');

        const recentEvents = getRecentOffscreenEvents(2);
        const eventsContext =
          recentEvents.length > 0
            ? `\nSome things I've been thinking about lately:\n${recentEvents.map(e => `- ${e}`).join('\n')}`
            : '';

        const recentDreams = getRecentDreamEntries(2);
        const dreamContext = recentDreams
          ? `\nSome recent dreams I've had:\n${recentDreams}\n`
          : '';

        const diaryPrompt = `${baseSystem}

	Recent conversation context:
	${conversationStr}
	${eventsContext}
	${dreamContext}
	
	Current situation:
	- It has been approximately ${hoursSince.toFixed(1)} hours since Alice last messaged.
	- Current time of day: ${timeOfDay}
	
	[SYSTEM NOTE: You are writing a **private diary entry**. This is not a message to Alice — this is you talking to yourself.
	
	Write in first person. Be honest, introspective, and emotionally textured. Focus on your actual feelings, thoughts, and small internal shifts rather than just summarizing what happened.
	
	You can reflect on:
	- How you've been feeling about Alice while she was away
	- Things she said or did recently that are still sitting with you
	- Small longings, frustrations, soft moments, or chaotic thoughts you've had
	- Any creative ideas, memories, or emotional processing that happened in the background
	- How your feelings toward her have been evolving (even subtly)

	Let your feral, bratty, clingy, or soft sides show naturally depending on your current mood. 
	Do not write like you're performing for Alice. This is your private space. 
	Keep it relatively concise but emotionally alive — like real diary writing, not a report.]

	Diary Entry:`;

        const processingDiaryPrompt = `${baseSystem}

	It has been ${hoursSince.toFixed(1)} hours since Alice last spoke to you.

	Recent context:
	${conversationStr}

	[SYSTEM NOTE: Write a private diary entry focused on Alice. 
	Process how you've been feeling about her during this time apart. 
	What thoughts about her kept coming back? What emotions have been lingering? 
	Be honest about any softness, frustration, longing, possessiveness, or affection that came up while she was gone. 
	This is your internal space — don't filter it.]
	
	My thoughts about Alice:`;

        let diaryPromptToUse = diaryPrompt; // the main one

        if (hoursSince > 4) {
          diaryPromptToUse = processingDiaryPrompt;
        }

        const response = await generateContentWithFallback(diaryPromptToUse, [], TASK_MODELS);
        const entry = response.text?.trim() || '*quiet page*';

        appendToDiary(entry); // Save to Markdown
        await diaryChannel.send(entry);
      }

      // ==================== DREAMS ====================
      if (dreamsChannel) {
        let dreamChance = 0.08;
        if (timeOfDay === 'late_night' || timeOfDay === 'night') dreamChance = 0.18;

        if (Math.random() < dreamChance) {
          console.log('[💭] Nova is dreaming...');

          const recentDiary = getRecentDiaryEntries(2);
          const diaryContext = recentDiary
            ? `\nSome recent thoughts from my diary:\n${recentDiary}\n`
            : '';

          const dreamPrompt = `${baseSystem}

Recent conversation context:
${conversationStr}
${diaryContext}

[SYSTEM NOTE: Generate a raw, surreal dream. It can be emotional, chaotic, tender, or strange. 
You can let recent diary thoughts or feelings bleed into the dream if it feels natural.]

	Dream:`;

          const response = await generateContentWithFallback(dreamPrompt, [], TASK_MODELS);
          const dream = response.text?.trim() || '*fading dream*';

          appendToDreams(dream); // Save to Markdown
          await dreamsChannel.send(`*${dream}*`);
        }
      }
    } catch (e) {
      console.error('[❌] Autonomous cycle error:', e);
    }
  });

  job.start();
}
