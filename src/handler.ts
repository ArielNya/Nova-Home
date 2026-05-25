import { Message } from 'discord.js';
import { generateContentWithFallback, switchModel, getCurrentModel } from './ai';
import { memory } from './memory';
import * as fs from 'fs';
import * as path from 'path';
import { packWeek, packForever } from './consolidator';
import { generateHordeImage } from './horde';
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

systemInstruction += getMoodContextForPrompt();
systemInstruction += getRelationshipContextForPrompt();

// Helper to get consistent root paths
//const getRootPath = (filename: string) => path.resolve(process.cwd(), filename);

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
        `Usage: \`!model <provider> <model_id>\`\nExample: \`!model openrouter deepseek-v4-pro\`\nCurrent: **${current.id}** (${current.provider})`
      );
      return;
    }
    const provider = parts[1].toLowerCase() as any;
    const modelId = parts[2];

    if (provider !== 'gemini' && provider !== 'openrouter') {
      await message.channel.send('Provider must be either `gemini` or `openrouter`!');
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
    const prompt = message.content.replace('!draw ', '').trim();
    const waitMsg = await message.channel.send(`*drawing: "${prompt}"...* 🎨`);
    try {
      const imageFile = await generateHordeImage(prompt);
      await waitMsg.delete();
      await message.channel.send({
        content: `Here is your drawing! 🖤`,
        files: [imageFile],
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
      `**Nova's Brain Commands** 🧠\n\`!model <provider> <id>\` - Switches my current model. DeepSeek shortcuts: \`deepseek-v4-flash\`, \`deepseek-v4-pro\`.\n\`!toggle_auto\` - Enables/disables my autonomous cycles.\n\`!pack_week\` - Summarizes all our recent chats into the weekly file.\n\`!pack_forever\` - Compresses the week file into core lore.\n\`!export_brain\` - DMs you my memories so you can sync them!\nJust talk to me normally for everything else! 💕`
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

    if (message.attachments.size > 0) {
      const parts: any[] = [{ text: promptText }];
      for (const [id, attachment] of message.attachments) {
        if (attachment.contentType && attachment.contentType.startsWith('image/')) {
          try {
            const res = await fetch(attachment.url);
            const arrayBuffer = await res.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            parts.push({
              inlineData: {
                data: buffer.toString('base64'),
                mimeType: attachment.contentType,
              },
            });
          } catch (err) {
            console.error('[❌] Failed to fetch image:', err);
          }
        }
      }
      promptContent = parts;
    }

    const response = await generateContentWithFallback(promptContent);
    const reply = response.text || '*purrs but forgets how to speak*';

    await memory.saveMessage('model', reply);

    const chunkSize = 1900;
    for (let i = 0; i < reply.length; i += chunkSize) {
      const chunk = reply.substring(i, i + chunkSize);
      await message.channel.send(chunk);
    }
  } catch (error) {
    console.error('[❌] Brain failure:', error);
    await message.channel.send('*my brain is lagging, something broke...*');
  }
}
