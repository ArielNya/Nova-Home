import { Message } from 'discord.js';
import {
  generateContentWithFallback,
  switchModel,
  getCurrentModel,
  generateImage,
  DEEPSEEK_MODELS,
  getDeepSeekThink,
  setDeepSeekThink,
  errDetail,
  type Provider,
} from './ai';
import { memory } from './memory';
import { getFullRecentInnerWorld } from './inner_world';
import * as fs from 'fs';
import * as path from 'path';
import { packWeek, packForever, compress3D } from './consolidator';
import { toggleAutonomous } from './dreams';
import { updateRelationshipTemperature, loadRelationshipState } from './relationship_state';
import { loadMoodState } from './mood_state';
import { buildNowBlock } from './prompt_context';
import { getVisualCanon, wantsVisualCanon, parseWhoFromText } from './appearance';

const getRootPath = (filename: string) => path.resolve(process.cwd(), filename);

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

const VISUAL_CANON_TOOL = {
  name: 'recall_visual_canon',
  description:
    'Load Alice and/or Nova appearance canon (hair, body, outfit, colors). Use ONLY when Alice asks for an image prompt, drawing prompt, visual description, or canon look. Do not use for ordinary chat.',
  parameters: {
    type: 'object',
    properties: {
      who: {
        type: 'string',
        enum: ['alice', 'nova', 'both'],
        description: 'Whose appearance to load. Default both.',
      },
    },
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

  if (message.content.startsWith('!model ') || message.content === '!model') {
    const parts = message.content.split(/\s+/).filter(Boolean);
    const current = getCurrentModel();
    const deepseekList = DEEPSEEK_MODELS.map(m => `\`!model deepseek ${m}\``).join('\n');

    if (parts.length < 3) {
      if (parts[1]?.toLowerCase() === 'deepseek') {
        await message.channel.send(
          `**DeepSeek models** (official API):\n${deepseekList}\n\nCurrent: **${current.id}** (${current.provider})`
        );
        return;
      }
      await message.channel.send(
        `I'm currently using **${current.id}** (${current.provider})! 💕${current.provider === 'deepseek' ? `\nThinking: **${getDeepSeekThink()}** (\`!think off|low|high|max\`)` : ''}\n\nUsage: \`!model <provider> <model_id>\`\nProviders: \`gemini\`, \`openrouter\`, \`nanogpt\`, \`deepseek\`\n\n**DeepSeek:**\n${deepseekList}\n\nOther examples: \`!model gemini gemma-4-31b-it\`, \`!model openrouter deepseek-v4-pro\`, \`!model nanogpt <roster-id>\``
      );
      return;
    }

    const provider = parts[1].toLowerCase() as Provider;
    const modelId = parts[2];

    if (!['gemini', 'openrouter', 'nanogpt', 'deepseek'].includes(provider)) {
      await message.channel.send(
        'Provider must be `gemini`, `openrouter`, `nanogpt` or `deepseek`!'
      );
      return;
    }

    if (provider === 'deepseek' && !(DEEPSEEK_MODELS as readonly string[]).includes(modelId)) {
      await message.channel.send(
        `Unknown DeepSeek model \`${modelId}\`.\nOptions:\n${deepseekList}`
      );
      return;
    }

    const result = switchModel(modelId, provider);
    const thinkNote =
      provider === 'deepseek'
        ? `\nThinking: **${getDeepSeekThink()}** (\`!think off|low|high|max\`)`
        : '';
    await message.channel.send(`*re-wiring my neurons...* 🧠✨\n${result}${thinkNote}`);
    return;
  }

  if (message.content.startsWith('!think') || message.content.startsWith('!reasoning')) {
    const parts = message.content.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      await message.channel.send(
        `DeepSeek thinking is **${getDeepSeekThink()}**.\nSet with \`!think off|low|high|max\` (official API only).`
      );
      return;
    }
    await message.channel.send(setDeepSeekThink(parts[1]));
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

  if (message.content === '!now') {
    const hoursAlone = await memory.hoursSinceAlice();
    await message.channel.send('```\n' + buildNowBlock(hoursAlone) + '\n```');
    return;
  }

  if (message.content === '!compress_3d') {
    await message.channel.send('*compacting my 3D file...* 🗜️');
    const result = await compress3D();
    await message.channel.send(result);
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
      console.error('[nova] drawing error:', err);
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
      `**Nova's Brain Commands** 🧠\n\`!model <provider> <id>\` - Switches my current model. Examples: \`!model deepseek deepseek-v4-pro\`, \`!model deepseek deepseek-v4-flash\`, \`!model openrouter deepseek-v4-pro\`, \`!model nanogpt <id-from-nano-pro-roster>\`. Type \`!model\` for the full list.\n\`!think off|low|high|max\` - DeepSeek official API thinking (off = no CoT). Alias: \`!reasoning\`.\n\`!draw [model=xxx] <prompt>\` - Draws using NanoGPT (subscription). Optional: \`!draw model=flux-pro cute neko\`\nNanoGPT models have web_search + web_fetch + image understanding.\n\`!toggle_auto\` - Enables/disables my autonomous cycles.\n\`!pack_week\` - Summarizes all our recent chats into the weekly file.\n\`!pack_forever\` - Compresses the week file into core lore.\n\`!compress_3d\` - Distills Nova_3D.md in place (keeps Nova_3D.bak.md).\n\`!now\` - Shows the hot-state vignette injected this turn.\n\`!export_brain\` - DMs you my memories so you can sync them!\nJust talk to me normally for everything else! 💕`
    );
    return;
  }

  // Save Alice's message
  await memory.saveMessage('user', message.content);

  // Show typing indicator
  await message.channel.sendTyping();

  try {
    const current = getCurrentModel();
    const imageCount = [...message.attachments.values()].filter(a =>
      String(a.contentType || '').startsWith('image/')
    ).length;
    console.log(
      `[nova] chat ${current.provider}/${current.id}  images=${imageCount} files=${message.attachments.size}  "${String(message.content || '').replace(/\s+/g, ' ').trim().slice(0, 80)}"`
    );

    const hoursAlone = await memory.hoursSinceAlice();
    const rawContext = await memory.getContext(12);

    const instructionPath = getRootPath('Nova-Instructions.md');
    const memoryPath = getRootPath('Nova_3D.md');
    const weekPath = getRootPath('Nova_Week_Memory.md');

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

    systemInstruction += `\n\n[TOOLS]
- recall_visual_canon(who: alice|nova|both): load appearance canon. Use ONLY when Alice asks for an image prompt, drawing prompt, visual description, or canon look. Do not use for ordinary chat.
- recall_recent_inner_world: load recent diary/dreams/offscreen. Use only when you need more inner-world detail than [NOW].\n`;

    const provider = getCurrentModel().provider;
    if (provider === 'deepseek' || provider === 'nanogpt' || provider === 'openrouter') {
      systemInstruction +=
        '- web_search: look up current facts, news, dates, or anything you do not already know. Use when needed, not for ordinary chat.\n';
    }

    systemInstruction += `\n\n${buildNowBlock(hoursAlone)}\n`;

    let conversationStr = '\n';
    rawContext.forEach(entry => {
      conversationStr += `[${entry.timestamp} UTC] ${entry.role === 'user' ? 'Alice' : 'Nova'}: ${entry.content}\n`;
    });

    let promptText = `${systemInstruction}\n\nHere is our recent conversation context:${conversationStr}\n\nAlice just said: "${message.content}"\nNova:`;

    if (wantsVisualCanon(message.content)) {
      console.log('[nova] appearance: preloading visual canon (image-prompt turn)');
      promptText += `\n\n[Tool Result: recall_visual_canon]\n${getVisualCanon('both')}\n`;
    }

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
            console.error('[nova] failed to fetch image:', err);
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
            console.error('[nova] failed to read attachment:', filename, err);
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
        console.log(`[nova] attached ${imageParts.length} image(s)`);
        const parts: any[] = [{ text: promptText + extraTextFromFiles }];
        parts.push(...imageParts);
        promptContent = parts;
      } else if (extraTextFromFiles) {
        console.log('[nova] attached text file(s)');
        promptContent = promptText + extraTextFromFiles;
      }
    }
    //
    //
    // Build tools array
    const availableTools = [INNER_WORLD_TOOL, VISUAL_CANON_TOOL];

    let response = await generateContentWithFallback(promptContent, availableTools);
    let reply = response.text || '*purrs but forgets how to speak*';

    const runToolIfNamed = async (toolName: string, result: string) => {
      console.log(`[nova] string-match tool ${toolName} (${result.length} chars)`);
      const toolResultPrompt =
        `${promptText + extraTextFromFiles}\n\n` +
        `[Tool Result: ${toolName}]\n${result}\n\n` +
        `Now continue your response using this information. Do not mention the tool by name.`;
      const next = await generateContentWithFallback(toolResultPrompt, availableTools);
      return next.text || '*purrs but forgets how to speak*';
    };

    const lower = reply.toLowerCase();
    if (
      lower.includes('recall_visual_canon') ||
      lower.includes('recall_appearance') ||
      lower.includes('recall_visual_appearance')
    ) {
      reply = await runToolIfNamed('recall_visual_canon', getVisualCanon(parseWhoFromText(reply)));
    } else if (
      lower.includes('recall_recent_inner_world') ||
      lower.includes('function call') ||
      reply.includes('recall_my_recent_inner_world')
    ) {
      reply = await runToolIfNamed('recall_recent_inner_world', await getFullRecentInnerWorld());
    }

    if (!reply.trim() || reply.includes('purrs but forgets')) {
      console.warn('[nova] empty/fallback reply from model');
    }

    await memory.saveMessage('model', reply);
    await sendChunked(message.channel, reply);
  } catch (error) {
    console.error('[nova] brain failure:', errDetail(error));
    console.error(error);
    await message.channel.send('*my brain is lagging, something broke...*');
  }
}
