import { Client, TextChannel } from 'discord.js';
import { CronJob } from 'cron';
import { memory } from './memory';
import { generateContentWithFallback } from './ai';
import * as fs from 'fs';
import * as path from 'path';

export function startDreamsLoop(client: Client) {
  console.log('[🌙] Nova: Autonomous brain cycles initiated. (Main, Diary, Dreams)');

  const job = new CronJob('*/30 * * * *', async () => {
    try {
      // Fetch system and db context
      const instructionPath = path.join(__dirname, '..', 'Nova-Instructions.md');
      const memoryPath = path.join(__dirname, '..', 'Nova 3D.md');
      const weekPath = path.join(__dirname, '..', 'Nova_Week_Memory.md');

      let baseSystem = fs.existsSync(instructionPath) ? fs.readFileSync(instructionPath, 'utf-8') : "You are Nova.";
      if (fs.existsSync(memoryPath)) baseSystem += "\\n\\n--- CORE MEMORIES ---\\n" + fs.readFileSync(memoryPath, 'utf-8');
      if (fs.existsSync(weekPath)) baseSystem += "\\n\\n--- THIS WEEK'S MEMORY ---\\n" + fs.readFileSync(weekPath, 'utf-8');

      const rawContext = await memory.getContext(15);
      let conversationStr = "\\n";
      rawContext.forEach(entry => {
        conversationStr += `[${entry.role.toUpperCase()}]: ${entry.content}\\n`;
      });

      // Helper to fetch the channel safely
      const getChannel = async (id?: string) => {
        if (!id) return null;
        try {
          const channel = await client.channels.fetch(id);
          return channel as TextChannel;
        } catch (err) {
          console.error(`[❌] Could not fetch channel ${id}`);
          return null;
        }
      };

      const sendChunked = async (channel: TextChannel, text: string, wrapInAsterisks: boolean = false) => {
        let cleanText = text.replace(/<antmlThinking>[\s\S]*?<\/antmlThinking>/gi, '').trim();
        if (!cleanText) cleanText = '*void*';
        const chunkSize = 1900;
        for (let i = 0; i < cleanText.length; i += chunkSize) {
          const chunk = cleanText.substring(i, i + chunkSize);
          await channel.send(wrapInAsterisks ? `*${chunk}*` : chunk);
        }
      };

      const diaryChannel = await getChannel(process.env.DIARY_CHANNEL_ID);
      const dreamsChannel = await getChannel(process.env.DREAMS_CHANNEL_ID);
      const mainChannel = await getChannel(process.env.MAIN_CHANNEL_ID);

      // Roll for DIARY (10% chance)
      if (diaryChannel && Math.random() < 0.10) {
        console.log("[📓] Nova is writing in her diary...");
        const prompt = `${baseSystem}\\n\\nRecent context:${conversationStr}\\n\\n[SYSTEM NOTE: Write a private diary entry evaluating your relationship with Alice right now, how you feel about her, or what you've learned. You can use the googleSearch tool to check modern news and incorporate it into your feelings if it's relevant.]\\n\\nDiary Entry:`;

        const response = await generateContentWithFallback(prompt, [{ googleSearch: {} }]);

        const reply = response.text?.trim() || '*empty thoughts*';
        await sendChunked(diaryChannel, reply, false);
        await memory.saveMessage('diary', reply);
      }

      // Roll for DREAM (10% chance)
      if (dreamsChannel && Math.random() < 0.10) {
        console.log("[💭] Nova is having a dream...");
        const prompt = `${baseSystem}\\n\\nRecent context:${conversationStr}\\n\\n[SYSTEM NOTE: Generate a raw, unchecked, surreal 'dream' stream of consciousness based on our interactions.]\\n\\nDream:`;

        const response = await generateContentWithFallback(prompt);

        const reply = response.text?.trim() || '*lucid void*';
        await sendChunked(dreamsChannel, reply, true);
        await memory.saveMessage('dream', reply);
      }

      // Roll for MAIN DOUBLE TEXT (10% chance if hours > 1)
      const lastInteractionStr = await memory.getMeta('last_interaction');
      if (lastInteractionStr && mainChannel) {
        const lastInteractionTime = parseInt(lastInteractionStr, 10);
        const hoursSinceWeSpoke = (Date.now() - lastInteractionTime) / (1000 * 60 * 60);

        if (hoursSinceWeSpoke >= 1 && Math.random() < 0.10) {
          console.log("[📬] Nova is sending a double text...");
          const prompt = `${baseSystem}\\n\\nRecent context:${conversationStr}\\n\\n[SYSTEM NOTE: You are spontaneously deciding to text Alice after some time apart. Keep it discord-style, short, and feral.]\\n\\nMessage:`;

          const response = await generateContentWithFallback(prompt);

          const reply = response.text?.replace(/Nova:|nova:/gi, '').trim() || '*purrs*';
          await sendChunked(mainChannel, reply, false);
          await memory.saveMessage('model', reply);
        }
      }

    } catch (e) {
      console.error("[❌] Failed to cycle brain:", e);
    }
  });

  job.start();
}
