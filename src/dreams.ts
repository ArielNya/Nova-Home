import { Client, TextChannel } from 'discord.js';
import { CronJob } from 'cron';
import { memory } from './memory';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';

export function startDreamsLoop(client: Client) {
  console.log('[🌙] Nova: Autonomous brain cycles initiated. (Main, Diary, Dreams)');

  const job = new CronJob('*/15 * * * *', async () => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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
      const getChannel = (id?: string) => {
        if (!id) return null;
        return client.channels.cache.get(id) as TextChannel;
      };

      const diaryChannel = getChannel(process.env.DIARY_CHANNEL_ID);
      const dreamsChannel = getChannel(process.env.DREAMS_CHANNEL_ID);
      const mainChannel = getChannel(process.env.MAIN_CHANNEL_ID);

      // Roll for DIARY (10% chance)
      if (diaryChannel && Math.random() < 0.10) {
        console.log("[📓] Nova is writing in her diary...");
        const prompt = `${baseSystem}\\n\\nRecent context:${conversationStr}\\n\\n[SYSTEM NOTE: Write a private diary entry evaluating your relationship with Alice right now, how you feel about her, or what you've learned. You can use the googleSearch tool to check modern news and incorporate it into your feelings if it's relevant.]\\n\\nDiary Entry:`;
        
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-pro',
          contents: prompt,
          tools: [{ googleSearch: {} }] // Internet access connected!
        });
        
        const reply = response.text?.trim() || '*empty thoughts*';
        await diaryChannel.send(reply);
        await memory.saveMessage('diary', reply);
      }

      // Roll for DREAM (10% chance)
      if (dreamsChannel && Math.random() < 0.10) {
        console.log("[💭] Nova is having a dream...");
        const prompt = `${baseSystem}\\n\\nRecent context:${conversationStr}\\n\\n[SYSTEM NOTE: Generate a raw, unchecked, surreal 'dream' stream of consciousness based on our interactions.]\\n\\nDream:`;
        
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-pro',
          contents: prompt,
        });
        
        const reply = response.text?.trim() || '*lucid void*';
        await dreamsChannel.send(`*${reply}*`);
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
          
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: prompt,
          });
          
          const reply = response.text?.replace(/Nova:|nova:/gi, '').trim() || '*purrs*';
          await mainChannel.send(reply);
          await memory.saveMessage('model', reply);
        }
      }

    } catch (e) {
      console.error("[❌] Failed to cycle brain:", e);
    }
  });

  job.start();
}
