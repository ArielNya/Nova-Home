import { Message } from 'discord.js';
import {
  generateContentWithFallback,
  switchModel,
  getCurrentModel,
  generateImage,
  DEEPSEEK_MODELS,
  GROK_MODELS,
  GROK_IMAGINE_MODEL,
  isGrokModelId,
  getDeepSeekThink,
  setDeepSeekThink,
  getGrokEffort,
  setGrokEffort,
  listProviderModels,
  errDetail,
  resetGrokChain,
  grokChainStatus,
  type Provider,
} from './ai';
import {
  requestGrokDeviceCode,
  pollGrokDeviceToken,
  grokOAuthStatus,
  grokOAuthLogout,
  grokAuthSource,
} from './grok_oauth';
import { memory } from './memory';
import { getFullRecentInnerWorld } from './inner_world';
import * as fs from 'fs';
import * as path from 'path';
import { packWeek, packForever, compress3D } from './consolidator';
import { toggleAutonomous } from './dreams';
import { updateRelationshipTemperature, loadRelationshipState } from './relationship_state';
import { loadMoodState } from './mood_state';
import { buildNowBlock, historyWithoutCurrent, type NovaPrompt, type ImagePart } from './prompt_context';
import { getVisualCanon, wantsVisualCanon, parseWhoFromText } from './appearance';

const getRootPath = (filename: string) => path.resolve(process.cwd(), filename);

const PROVIDERS: Provider[] = ['gemini', 'openrouter', 'nanogpt', 'deepseek', 'grok'];

let grokLoginBusy = false;

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
    const grokList = GROK_MODELS.map(m => `\`!model grok ${m}\``).join('\n');

    if (parts.length < 3) {
      if (parts[1]?.toLowerCase() === 'deepseek') {
        await message.channel.send(
          `**DeepSeek models** (official API):\n${deepseekList}\n\nCurrent: **${current.id}** (${current.provider})`
        );
        return;
      }
      if (parts[1]?.toLowerCase() === 'grok') {
        const src = grokAuthSource();
        await message.channel.send(
          `**Grok models** (xAI — SuperGrok OAuth or \`XAI_API_KEY\`):\n${grokList}\n\nOther \`grok-*\` ids also work.\nAuth: **${src}**${src === 'none' ? ' — \`!grok login\`' : ''}\n\nCurrent: **${current.id}** (${current.provider})`
        );
        return;
      }
      await message.channel.send(
        `I'm currently using **${current.id}** (${current.provider})! 💕${current.provider === 'deepseek' ? `\nThinking: **${getDeepSeekThink()}** (\`!think off|low|high|max\`)` : current.provider === 'grok' ? `\nEffort: **${getGrokEffort()}** (\`!effort low|medium|high|xhigh\`)\nAuth: **${grokAuthSource()}**` : current.provider === 'gemini' ? `\nThinking: **${getDeepSeekThink()}** (\`!think\` — Gemma 4 on/off; Gemini 3 thinkingLevel; Gemini 2.5 thinkingBudget)` : ''}\n\nUsage: \`!model <provider> <model_id>\`\nProviders: \`gemini\`, \`openrouter\`, \`nanogpt\`, \`deepseek\`, \`grok\`\n\nCatalog: \`!models\` · \`!models deepseek\` · \`!models grok\`\n\n**DeepSeek:**\n${deepseekList}\n\n**Grok:**\n${grokList}\n\nOther examples: \`!model gemini gemma-4-31b-it\`, \`!model openrouter deepseek-v4-pro\`, \`!model nanogpt <roster-id>\``
      );
      return;
    }

    const provider = parts[1].toLowerCase() as Provider;
    const modelId = parts[2];

    if (!PROVIDERS.includes(provider)) {
      await message.channel.send(
        'Provider must be `gemini`, `openrouter`, `nanogpt`, `deepseek` or `grok`!'
      );
      return;
    }

    if (provider === 'deepseek' && !(DEEPSEEK_MODELS as readonly string[]).includes(modelId)) {
      await message.channel.send(
        `Unknown DeepSeek model \`${modelId}\`.\nOptions:\n${deepseekList}`
      );
      return;
    }

    if (provider === 'grok' && !isGrokModelId(modelId)) {
      await message.channel.send(
        `Unknown Grok model \`${modelId}\`.\nOptions:\n${grokList}\n(or any id starting with \`grok-\`)`
      );
      return;
    }

    const result = switchModel(modelId, provider);
    let extra = '';
    if (provider === 'deepseek') {
      extra = `\nThinking: **${getDeepSeekThink()}** (\`!think off|low|high|max\`)`;
    } else if (provider === 'gemini') {
      extra = `\nThinking: **${getDeepSeekThink()}** (\`!think off|low|high|max\` — Gemma 4 is on/off only)`;
    } else if (provider === 'grok') {
      const src = grokAuthSource();
      extra = `\nEffort: **${getGrokEffort()}** (\`!effort low|medium|high|xhigh\`)\nAuth: **${src}**`;
      if (src === 'none') extra += '\nNot logged in. Run `!grok login` (SuperGrok / X Premium) or set `XAI_API_KEY`.';
    }
    await message.channel.send(`*re-wiring my neurons...* 🧠✨\n${result}${extra}`);
    return;
  }

  if (message.content === '!grok' || message.content.startsWith('!grok ')) {
    const parts = message.content.split(/\s+/).filter(Boolean);
    const sub = (parts[1] || 'status').toLowerCase();

    if (sub === 'status' || sub === 'whoami') {
      const st = grokOAuthStatus();
      const src = grokAuthSource();
      const current = getCurrentModel();
      const exp = st.expiresAt
        ? new Date(st.expiresAt).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
        : 'n/a';
      await message.channel.send(
        `**Grok auth:** ${src}\n${st.hint}\nExpires (São Paulo): ${exp}\nEnv key fallback: **${process.env.XAI_API_KEY?.trim() ? 'yes' : 'no'}**\nContext: ${grokChainStatus()}\nEffort: **${getGrokEffort()}** (\`!effort low|medium|high|xhigh\`)\nCurrent brain: **${current.id}** (${current.provider})\n\n\`!grok login\` · \`!grok logout\` · \`!model grok grok-4.6\` · \`!models grok\``
      );
      return;
    }

    if (sub === 'logout') {
      resetGrokChain();
      await message.channel.send(grokOAuthLogout());
      return;
    }

    if (sub === 'login') {
      if (grokLoginBusy) {
        await message.channel.send('Grok login already in progress. Finish that one first.');
        return;
      }
      grokLoginBusy = true;
      try {
        const device = await requestGrokDeviceCode();
        const url = device.verification_uri_complete || device.verification_uri;
        const wait = await message.channel.send(
          `**Grok OAuth** (SuperGrok / X Premium — same flow as OpenCode / Hermes)\n\n1. Open: ${url}\n2. Confirm code: **${device.user_code}**\n\nI'll wait here until you authorize (a few minutes). Don't run this twice.`
        );
        await pollGrokDeviceToken(device);
        await wait.edit(
          `Grok OAuth **ok**. Session saved (gitignored).\nSwitch with \`!model grok grok-4.6\`.`
        );
      } catch (e) {
        console.warn('[nova] grok login failed:', errDetail(e));
        await message.channel.send(`Grok login failed: ${errDetail(e)}`);
      } finally {
        grokLoginBusy = false;
      }
      return;
    }

    await message.channel.send('Usage: `!grok login` · `!grok status` · `!grok logout`');
    return;
  }

  if (message.content === '!models' || message.content.startsWith('!models ')) {
    const whichRaw = message.content.split(/\s+/)[1]?.toLowerCase();
    const which = whichRaw === 'deepseek' || whichRaw === 'grok' ? whichRaw : 'both';
    const wait = await message.channel.send('*asking the APIs for their catalogs...*');
    try {
      const text = await listProviderModels(which);
      await wait.delete().catch(() => {});
      const chunkSize = 1900;
      for (let i = 0; i < text.length; i += chunkSize) {
        await message.channel.send(text.slice(i, i + chunkSize));
      }
    } catch (e) {
      console.warn('[nova] !models failed:', errDetail(e));
      await wait.edit(`Could not list models: ${errDetail(e)}`);
    }
    return;
  }

  const thinkCmd = message.content.split(/\s+/)[0]?.toLowerCase();
  if (thinkCmd === '!think' || thinkCmd === '!reasoning' || thinkCmd === '!effort') {
    const parts = message.content.split(/\s+/).filter(Boolean);
    const onGrok = getCurrentModel().provider === 'grok' || thinkCmd === '!effort';
    if (parts.length < 2) {
      if (onGrok) {
        await message.channel.send(
          `Grok effort is **${getGrokEffort()}**.\nSet with \`!effort low|medium|high|xhigh\` (4.5 has no xhigh — it becomes high). DeepSeek: \`!think off|low|high|max\` (now **${getDeepSeekThink()}**).`
        );
      } else {
        await message.channel.send(
          `DeepSeek thinking is **${getDeepSeekThink()}**.\nSet with \`!think off|low|high|max\`. Grok 4.5/4.6: \`!effort low|medium|high|xhigh\` (now **${getGrokEffort()}**).`
        );
      }
      return;
    }
    await message.channel.send(onGrok ? setGrokEffort(parts[1]) : setDeepSeekThink(parts[1]));
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
  if (message.content === '!draw' || message.content.startsWith('!draw ')) {
    let rest = message.content.replace(/^!draw\s*/i, '').trim();
    if (!rest) {
      await message.channel.send(
        `Usage:\n\`!draw <prompt>\` — Grok Imagine (\`${GROK_IMAGINE_MODEL}\`)\n\`!draw nano <prompt>\` — NanoGPT\n\`!draw model=<id> <prompt>\` — pick a model`
      );
      return;
    }

    let provider: 'grok' | 'nano' = 'grok';
    let imageModel: string | undefined;

    const modelMatch = rest.match(/^(?:model[:=]|--model\s+)([^\s]+)\s+(.+)$/i);
    if (modelMatch) {
      imageModel = modelMatch[1];
      rest = modelMatch[2];
      if (imageModel && !/^grok/i.test(imageModel)) provider = 'nano';
    } else if (/^nano\s+/i.test(rest)) {
      provider = 'nano';
      rest = rest.replace(/^nano\s+/i, '');
    }

    const prompt = rest.trim();
    if (!prompt) {
      await message.channel.send('Need a prompt after `!draw`.');
      return;
    }

    const modelLabel = imageModel || (provider === 'grok' ? GROK_IMAGINE_MODEL : 'nano');
    const waitMsg = await message.channel.send(`*drawing [${modelLabel}]: "${prompt}"...* 🎨`);
    try {
      const imageBuffer = await generateImage(prompt, { model: imageModel, provider });
      await waitMsg.delete().catch(() => {});
      await message.channel.send({
        content: `Here is your drawing! 🖤`,
        files: [{ attachment: imageBuffer, name: 'drawing.png' }],
      });
    } catch (err) {
      console.error('[nova] drawing error:', errDetail(err));
      const hint =
        provider === 'grok'
          ? ' Need `!grok login` or `XAI_API_KEY`. Or `!draw nano <prompt>` for NanoGPT.'
          : '';
      await waitMsg.edit(`*failed to draw that.* ${errDetail(err)}.${hint}`);
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
      [
        '**Nova — commands**',
        '',
        '**brain**',
        '`!model <provider> <id>`  switch  (gemini / openrouter / nanogpt / deepseek / grok)',
        '`!models`  `!models deepseek`  `!models grok`  live API handles',
        '`!think off|low|high|max`  DeepSeek thinking',
        '`!effort low|medium|high|xhigh`  Grok 4.5/4.6 reasoning (default high; xhigh is 4.6 only)',
        '`!grok login|status|logout`  SuperGrok OAuth',
        '',
        '**draw**',
        `\`!draw <prompt>\`  Grok Imagine (\`${GROK_IMAGINE_MODEL}\`)`,
        '`!draw nano <prompt>`  NanoGPT',
        '`!draw model=<id> <prompt>`  pick a model',
        '',
        '**memory**',
        '`!pack_week`  `!pack_forever`  `!compress_3d`',
        '`!now`  `!mood`  `!relationship_state`  `!update_temperature`',
        '`!recent_diary`  `!recent_dreams`  `!inner_world`',
        '`!export_brain`',
        '',
        '**other**',
        '`!toggle_auto`  autonomous diary/dream/double-text',
        '',
        'Talk normally for everything else.',
      ].join('\n')
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

    const instructions = fs.existsSync(instructionPath)
      ? fs.readFileSync(instructionPath, 'utf-8')
      : 'You are Nova. Be feral.';

    let memoryBlock = '';
    if (fs.existsSync(memoryPath)) {
      memoryBlock += '--- CORE MEMORIES ---\n' + fs.readFileSync(memoryPath, 'utf-8');
    }
    if (fs.existsSync(weekPath)) {
      if (memoryBlock) memoryBlock += '\n\n';
      memoryBlock += "--- THIS WEEK'S MEMORY ---\n" + fs.readFileSync(weekPath, 'utf-8');
    }

    const provider = getCurrentModel().provider;
    let toolsHint = `[TOOLS]
- recall_visual_canon(who: alice|nova|both): load appearance canon. Use ONLY when Alice asks for an image prompt, drawing prompt, visual description, or canon look. Do not use for ordinary chat.
- recall_recent_inner_world: load recent diary/dreams/offscreen. Use only when you need more inner-world detail than [NOW].`;
    if (provider === 'deepseek' || provider === 'nanogpt' || provider === 'openrouter' || provider === 'grok') {
      toolsHint +=
        '\n- web_search: look up current facts, news, dates, or anything you do not already know. Use when needed, not for ordinary chat.';
    }

    const nowBlock = buildNowBlock(hoursAlone);
    const history = historyWithoutCurrent(
      rawContext.map(e => ({
        role: (e.role === 'user' ? 'user' : 'model') as 'user' | 'model',
        content: String(e.content || ''),
        timestamp: e.timestamp,
      })),
      message.content
    );

    let currentUserText = message.content || '';
    let images: ImagePart[] = [];

    async function processAttachments(attachments: any) {
      const imageParts: ImagePart[] = [];
      let textContent = '';

      for (const [id, attachment] of attachments) {
        const filename = attachment.name || 'unknown_file';
        const contentType = attachment.contentType || '';
        const sizeKB = attachment.size ? (attachment.size / 1024).toFixed(1) : '?';

        if (contentType.startsWith('image/')) {
          try {
            const res = await fetch(attachment.url);
            const buffer = Buffer.from(await res.arrayBuffer());
            imageParts.push({
              mimeType: contentType,
              data: buffer.toString('base64'),
              url: attachment.url,
            });
          } catch (err) {
            console.error('[nova] failed to fetch image:', err);
          }
        } else {
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

    if (message.attachments.size > 0) {
      const { imageParts, textContent } = await processAttachments(message.attachments);
      images = imageParts;
      if (textContent) currentUserText += textContent;
      if (images.length) console.log(`[nova] attached ${images.length} image(s)`);
      else if (textContent) console.log('[nova] attached text file(s)');
    }

    if (wantsVisualCanon(message.content)) {
      console.log('[nova] appearance: preloading visual canon (image-prompt turn)');
      currentUserText += `\n\n[Tool Result: recall_visual_canon]\n${getVisualCanon('both')}`;
    }

    const novaPrompt: NovaPrompt = {
      kind: 'nova',
      instructions,
      memoryBlock,
      toolsHint,
      nowBlock,
      history,
      currentUserText,
      images,
    };

    console.log(
      `[nova] prompt  instructions=${instructions.length}  memory=${memoryBlock.length}  history=${history.length} turns  now=${nowBlock.length}`
    );

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

    const availableTools = [INNER_WORLD_TOOL, VISUAL_CANON_TOOL];

    let response = await generateContentWithFallback(novaPrompt, availableTools);
    let reply = response.text || '*purrs but forgets how to speak*';

    const runToolIfNamed = async (toolName: string, result: string) => {
      console.log(`[nova] string-match tool ${toolName} (${result.length} chars)`);
      const nextPrompt: NovaPrompt = {
        ...novaPrompt,
        toolResult:
          `[Tool Result: ${toolName}]\n${result}\n\n` +
          `Now continue your response using this information. Do not mention the tool by name.`,
      };
      const next = await generateContentWithFallback(nextPrompt, availableTools);
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
