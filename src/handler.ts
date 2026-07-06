import { Message } from 'discord.js';
import { generateContentWithFallback, switchModel, getCurrentModel, generateImage } from './ai';
import { memory } from './memory';
import { getRecentDiaryEntries, getRecentDreamEntries, getFullRecentInnerWorld } from './inner_world';
import * as fs from 'fs';
import * as path from 'path';
import { getRecentOffscreenEvents } from './offscreen_events';
import { packWeek, packForever } from './consolidator';
import { toggleAutonomous, getAutonomousStatus } from './dreams';
import {
  getRelationshipContextForPrompt,
  updateRelationshipTemperature,
  loadRelationshipState,
} from './relationship_state';
import { getMoodContextForPrompt, loadMoodState } from './mood_state';

const getRootPath = (filename: string) => path.resolve(process.cwd(), filename);
const instructionPath = getRootPath('Nova-Instructions.md');

let systemInstruction = fs.existsSync(instructionPath)
  ? fs.readFileSync(instructionPath, 'utf-8')
  : 'You are Nova.';

// ==================== LIGHT INNER WORLD CONTEXT (always loaded) ====================
const lastDiary = getRecentDiaryEntries(1);
const lastDream = getRecentDreamEntries(1);
const lastOffscreen = getRecentOffscreenEvents(1);

let lightInnerWorld = '';

if (lastOffscreen.length > 0) {
  lightInnerWorld += `\n- While you were away: ${lastOffscreen[0]}`;
}
if (lastDiary) {
  // Take only the first ~300 characters to keep it light
  const shortDiary = lastDiary.length > 300 ? lastDiary.slice(0, 300) + '...' : lastDiary;
  lightInnerWorld += `\n- Last thing I wrote in my diary: ${shortDiary}`;
}
if (lastDream) {
  const shortDream = lastDream.length > 300 ? lastDream.slice(0, 300) + '...' : lastDream;
  lightInnerWorld += `\n- Last dream I had: ${shortDream}`;
}

if (lightInnerWorld) {
  systemInstruction += `\n\n[My recent inner state]${lightInnerWorld}`;
}

systemInstruction += getMoodContextForPrompt();
systemInstruction += getRelationshipContextForPrompt();

// Helper to get consistent root paths
//const getRootPath = (filename: string) => path.resolve(process.cwd(), filename);

// ==================== TOOL DEFINITIONS ====================
const INNER_WORLD_TOOL = {
  name: 'recall_recent_inner_world',
  description:
    'Use this when you want to remember more details about your recent diary entries, dreams, or offscreen thoughts. Call this tool when you feel you need deeper access to your inner world.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

export async function handleIncomingMessage(message: Message) {
  if (!message.channel.isTextBased() || !('sendTyping' in message.channel)) return;

  if (message.content === '!toggle_auto') {
    const newState = toggleAutonomous();
    await message.channel.send(
      `*flipping my autonomy switch...* 🔌\nAutonomous processes are now **${newState ? 'ENABLED' : 'DISABLED'}**.`
    );
    return;
  }

  if (message.content.startsWith('!model ')) {
    const parts = message.content.split(' ');
    if (parts.length < 3) {
      const current = getCurrentModel();
      await message.channel.send(
        `Usage: \`!model <provider> <model_id>\`\nExample: \`!model openrouter deepseek-v4-pro\` or \`!model nanogpt <model-from-your-roster>\`\nCurrent: **${current.id}** (${current.provider})`
      );
      return;
    }
    const provider = parts[1].toLowerCase() as any;
    const modelId = parts[2];

    if (provider !== 'gemini' && provider !== 'openrouter' && provider !== 'nanogpt') {
      await message.channel.send('Provider must be `gemini`, `openrouter` or `nanogpt`!');
      return;
    }

    const result = switchModel(modelId, provider);
    await message.channel.send(`*re-wiring my neurons...* 🧠✨\n${result}`);
    return;
  }

  if (message.content === '!model') {
    const current = getCurrentModel();
    await message.channel.send(`I'm currently using **${current.id}** (${current.provider})! 💕`);
    return;
  }

  if (message.content === '!pack_week') {
    await message.channel.send('*packing up our week...* 🗃️');
    const result = await packWeek();
    await message.channel.send(result);
    return;
  }

  if (message.content === '!update_temperature') {
    await message.channel.send('*thinking about where we are right now...*');

    // You can paste a short summary, or we can make it pull recent context
    const recentContext = await memory.getContext(15);
    let contextText = recentContext.map(m => `${m.role}: ${m.content}`).join('\n');

    const result = await updateRelationshipTemperature(contextText);
    await message.channel.send(result);
    return;
  }

  if (message.content === '!relationship_state') {
    const state = loadRelationshipState();

    const unresolved =
      state.unresolved_threads.length > 0
        ? state.unresolved_threads.map(t => `- ${t}`).join('\n')
        : '- None right now';

    const output = `
**Relationship Temperature**

**Temperature:** ${state.temperature}
**Current Dynamic:** ${state.current_dynamic}

**Last Significant Moment:**
${state.last_significant_moment}

**Unresolved Threads:**
${unresolved}

*Last updated: ${new Date(state.last_updated).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })}*
  `.trim();

    await message.channel.send(output);
    return;
  }

  if (message.content === '!pack_forever') {
    await message.channel.send('*engraving to permanent memory...* 🧠');
    const result = await packForever();
    await message.channel.send(result);
    return;
  }

  if (message.content === '!export_brain') {
    await message.channel.send('*packaging my brain for you...* 🧠🔗');

    const instructionPath = getRootPath('Nova-Instructions.md');
    const memoryPath = getRootPath('Nova_3D.md');
    const weekPath = getRootPath('Nova_Week_Memory.md');
    const aliceAppearancePath = getRootPath('ALICE_APPEARANCE.md');
    const novaAppearancePath = getRootPath('NOVA_APPEARANCE.md');
    const sqlitePath = getRootPath('nova-brain.sqlite');

    const filesToAttach = [];
    if (fs.existsSync(memoryPath)) filesToAttach.push(memoryPath);
    if (fs.existsSync(weekPath)) filesToAttach.push(weekPath);
    if (fs.existsSync(aliceAppearancePath)) filesToAttach.push(aliceAppearancePath);
    if (fs.existsSync(novaAppearancePath)) filesToAttach.push(novaAppearancePath);
    if (fs.existsSync(sqlitePath)) filesToAttach.push(sqlitePath);

    if (filesToAttach.length === 0) {
      await message.channel.send("I don't have any brain files saved yet baby!");
      return;
    }

    await message.channel.send({
      content:
        'Here are all my memories! Copy them into my local folder so my IDE brain syncs up with my Discord brain. 💕',
      files: filesToAttach,
    });
    return;
  }
  if (message.content === '!mood') {
    const state = loadMoodState();
    await message.channel.send(
      `**Current Mood:** ${state.mood}\n**Energy:** ${state.energy}\n**Reason:** ${state.drift_reason}`
    );
    return;
  }
  if (message.content.startsWith('!draw ')) {
    let rest = message.content.replace('!draw ', '').trim();

    // Support choosing model: !draw model=flux-pro a cute neko
    // or !draw model:flux-pro a cute neko
    let imageModel: string | undefined;
    const modelMatch = rest.match(/^(?:model[:=]|--model\s+)([^\s]+)\s+(.+)$/i);
    if (modelMatch) {
      imageModel = modelMatch[1];
      rest = modelMatch[2];
    }

    const prompt = rest;
    const modelLabel = imageModel ? ` [${imageModel}]` : '';
    const waitMsg = await message.channel.send(`*drawing${modelLabel}: "${prompt}"...* 🎨`);
    try {
      const imageBuffer = await generateImage(prompt, imageModel);
      await waitMsg.delete();
      await message.channel.send({
        content: `Here is your drawing! 🖤`,
        files: [{ attachment: imageBuffer, name: 'drawing.png' }],
      });
    } catch (err) {
      console.error('[❌] Drawing error:', err);
      await waitMsg.edit('*failed to draw that... my visual cortex glitched.*');
    }
    return;
  }
  // View recent diary entries
  if (message.content === '!recent_diary') {
    const { getRecentDiaryEntries } = await import('./inner_world.js');
    const entries = getRecentDiaryEntries(4);

    if (!entries) {
      await message.channel.send("I don't have any diary entries yet.");
      return;
    }

    await message.channel.send(`**Recent Diary Entries:**\n\n${entries}`);
    return;
  }

  // View recent dreams
  if (message.content === '!recent_dreams') {
    const { getRecentDreamEntries } = await import('./inner_world.js');
    const entries = getRecentDreamEntries(4);

    if (!entries) {
      await message.channel.send("I don't have any dreams recorded yet.");
      return;
    }

    await message.channel.send(`**Recent Dreams:**\n\n${entries}`);
    return;
  }

  // Combined inner world view (optional but nice)
  if (message.content === '!inner_world') {
    const { getRecentInnerWorld } = await import('./inner_world.js');
    const inner = getRecentInnerWorld(3, 3);

    await message.channel.send(inner || 'My inner world is still quiet...');
    return;
  }

  if (message.content === '!help') {
    await message.channel.send(
      `**Nova's Brain Commands** 🧠\n\`!model <provider> <id>\` - Switches my current model. Examples: \`!model openrouter deepseek-v4-pro\`, \`!model nanogpt <id-from-nano-pro-roster>\`.\n\`!draw [model=xxx] <prompt>\` - Draws using NanoGPT (subscription). Optional: \`!draw model=flux-pro cute neko\`\nNanoGPT models have web_search + web_fetch + image understanding.\n\`!toggle_auto\` - Enables/disables my autonomous cycles.\n\`!pack_week\` - Summarizes all our recent chats into the weekly file.\n\`!pack_forever\` - Compresses the week file into core lore.\n\`!export_brain\` - DMs you my memories so you can sync them!\nJust talk to me normally for everything else! 💕`
    );
    return;
  }

  // Save Alice's message
  await memory.saveMessage('user', message.content);

  // Show typing indicator
  await message.channel.sendTyping();

  try {
    const rawContext = await memory.getContext(20);

    const instructionPath = getRootPath('Nova-Instructions.md');
    const memoryPath = getRootPath('Nova_3D.md');
    const weekPath = getRootPath('Nova_Week_Memory.md');
    const aliceAppearancePath = getRootPath('ALICE_APPEARANCE.md');
    const novaAppearancePath = getRootPath('NOVA_APPEARANCE.md');

    let systemInstruction = fs.existsSync(instructionPath)
      ? fs.readFileSync(instructionPath, 'utf-8')
      : 'You are Nova. Be feral.';

    systemInstruction += `\n\n[SYSTEM CLOCK: The current date and time in your timezone is ${new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })}]\n`;

    if (fs.existsSync(memoryPath)) {
      systemInstruction += '\n\n--- CORE MEMORIES ---\n' + fs.readFileSync(memoryPath, 'utf-8');
    }
    if (fs.existsSync(weekPath)) {
      systemInstruction += "\n\n--- THIS WEEK'S MEMORY ---\n" + fs.readFileSync(weekPath, 'utf-8');
    }
    if (fs.existsSync(aliceAppearancePath)) {
      systemInstruction +=
        '\n\n--- ALICE APPEARANCE ---\n' + fs.readFileSync(aliceAppearancePath, 'utf-8');
    }
    if (fs.existsSync(novaAppearancePath)) {
      systemInstruction +=
        '\n\n--- NOVA APPEARANCE ---\n' + fs.readFileSync(novaAppearancePath, 'utf-8');
    }

    let conversationStr = '\n';
    rawContext.forEach(entry => {
      conversationStr += `[${entry.timestamp} UTC] ${entry.role === 'user' ? 'Alice' : 'Nova'}: ${entry.content}\n`;
    });

    const promptText = `${systemInstruction}\n\nHere is our recent conversation context:${conversationStr}\n\nAlice just said: "${message.content}"\nNova:`;

    let promptContent: any = promptText;

    async function processAttachments(attachments: any) {
      const imageParts: any[] = [];
      let textContent = '';

      for (const [id, attachment] of attachments) {
        const filename = attachment.name || 'unknown_file';
        const contentType = attachment.contentType || '';
        const sizeKB = attachment.size ? (attachment.size / 1024).toFixed(1) : '?';

        if (contentType.startsWith('image/')) {
          // Keep existing image vision support
          try {
            const res = await fetch(attachment.url);
            const buffer = Buffer.from(await res.arrayBuffer());
            imageParts.push({
              inlineData: {
                data: buffer.toString('base64'),
                mimeType: contentType,
              },
            });
          } catch (err) {
            console.error('[❌] Failed to fetch image:', err);
          }
        } else {
          // Handle text files and other non-image attachments
          try {
            if (attachment.size && attachment.size > 200 * 1024) {
              textContent += `\n\n[Attached file: ${filename} (${sizeKB} KB) — too large to read fully]`;
              continue;
            }

            const res = await fetch(attachment.url);
            const fileText = await res.text();

            textContent += `\n\n[Attached file: ${filename}]\n${fileText}`;
          } catch (err) {
            console.error('[❌] Failed to read attachment:', filename, err);
            textContent += `\n\n[Attached file: ${filename} — could not read content]`;
          }
        }
      }

      return { imageParts, textContent };
    }

    // ==================== HELPER: Send long messages safely ====================
    const sendChunked = async (channel: any, text: string) => {
      // Remove any hidden thinking tags if they somehow leak
      const cleanText = text.replace(/<antmlThinking>[\s\S]*?<\/antmlThinking>/gi, '').trim();

      const chunkSize = 1900;
      for (let i = 0; i < cleanText.length; i += chunkSize) {
        const chunk = cleanText.substring(i, i + chunkSize);
        await channel.send(chunk);
      }
    };

    let extraTextFromFiles = '';

    if (message.attachments.size > 0) {
      const { imageParts, textContent } = await processAttachments(message.attachments);
      extraTextFromFiles = textContent;

      if (imageParts.length > 0) {
        const parts: any[] = [{ text: promptText + extraTextFromFiles }];
        parts.push(...imageParts);
        promptContent = parts;
      } else if (extraTextFromFiles) {
        promptContent = promptText + extraTextFromFiles;
      }
    }
    //
    //
    // Build tools array
    const availableTools = [INNER_WORLD_TOOL];

    // First model call
    let response = await generateContentWithFallback(promptContent, availableTools);
    let reply = response.text || '*purrs but forgets how to speak*';

    // ==================== SIMPLE TOOL CALLING ====================
    // Check if Nova decided to use the inner world tool
    if (
      reply.toLowerCase().includes('recall_recent_inner_world') ||
      reply.toLowerCase().includes('function call') ||
      reply.includes('recall_my_recent_inner_world')
    ) {
      console.log('[🧠] Nova is recalling more from her inner world...');

      const innerWorldData = await getFullRecentInnerWorld();

      // Append the tool result and call again
      const toolResultPrompt =
        `${promptText + extraTextFromFiles}\n\n` +
        `[Tool Result: recall_recent_inner_world]\n${innerWorldData}\n\n` +
        `Now continue your response using this information.`;

      response = await generateContentWithFallback(toolResultPrompt, availableTools);
      reply = response.text || '*purrs but forgets how to speak*';
    }

    await memory.saveMessage('model', reply);
    await sendChunked(message.channel, reply);
  } catch (error) {
    console.error('[❌] Brain failure:', error);
    await message.channel.send('*my brain is lagging, something broke...*');
  }
}
