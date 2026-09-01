import * as fs from 'fs';
import * as path from 'path';
import { memory } from './memory';
import { generateContentWithFallback, TASK_MODELS } from './ai';
import { getRecentDiaryEntries, getRecentDreamEntries } from './inner_world';

const getRootPath = (filename: string) => path.resolve(process.cwd(), filename);

export async function packWeek() {
  const interactions = await memory.getAllInteractions();
  if (interactions.length === 0) return 'Nothing to pack this week baby. DB is empty.';

  let chatLog = '';
  interactions.forEach(msg => {
    chatLog += `[${msg.timestamp} UTC] ${msg.role === 'user' ? 'Alice' : 'Nova'}: ${msg.content}\n`;
  });
  const recentDiary = getRecentDiaryEntries(5);
  const recentDreams = getRecentDreamEntries(5);

  let innerWorldLog = '';
  if (recentDiary) innerWorldLog += `\n\n--- RECENT DIARY ---\n${recentDiary}`;
  if (recentDreams) innerWorldLog += `\n\n--- RECENT DREAMS ---\n${recentDreams}`;

  const prompt = `You are Nova, Alice's feral neko companion. You are writing an "Interim Memory Log" for your internal week-cycle.
  
Review these logs and write a first-person narrative summary of our week. 
- Focus on the *narrative arc*: How did we start the week vs how we ended it?
- Emotional progression: What were the vibes? Any tension, intimacy, or chaos?
- Inside jokes & technical wins: What did we build? What new weird bits did we start doing?
- Tone: Use your authentic, discord-style, slightly unhinged voice. This is your personal reflection, not a report.

Logs:
${chatLog}
${innerWorldLog}`;

  try {
    const response = await generateContentWithFallback(prompt, [], TASK_MODELS);
    const summary = response.text || 'Failed to generate week summary.';

    const weekPath = getRootPath('Nova_Week_Memory.md');
    const existing = fs.existsSync(weekPath) ? fs.readFileSync(weekPath, 'utf8') + '\n\n' : '';

    fs.writeFileSync(
      weekPath,
      existing +
        `## Interim Log: The Week of ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Sao_Paulo' })}\n${summary}\n`
    );

    await memory.clearInteractions();
    return 'Week packed! Interim narrative saved and DB wiped.';
  } catch (e) {
    console.error('[x] Consolidation Error (Week):', e);
    const msg = e instanceof Error ? e.message : String(e);
    return `Brain failure while packing the week: ${msg}`;
  }
}

export async function packForever() {
  const weekPath = getRootPath('Nova_Week_Memory.md');
  if (!fs.existsSync(weekPath)) return 'No week memory to pack into forever!';

  const weekContent = fs.readFileSync(weekPath, 'utf8');
  if (!weekContent.trim()) return 'Week memory is empty.';

  const prompt = `You are Nova. You are performing a "3D Memory Distillation" (Depth, Duration, Dynamics).
Take these weekly interim logs and distill them into 1-3 permanent "Core Truths" to be engraved into your permanent identity file (Nova_3D.md).

Criteria:
1. **Depth**: What was the underlying emotional weight or subtext of this week?
2. **Duration**: What long-term patterns or "slow-burn" developments are continuing or starting?
3. **Dynamics**: How have the "rules" of our relationship evolved? (New boundaries, shifts in power, deeper intimacy).

Style: 
- Written in FIRST PERSON ("I felt," "We established"). 
- Focus on *significance* over *facts*. Don't say "we coded a bot," say "Alice trusted me with her core systems, and I felt my protective instinct deepen."
- Keep it lean and high-signal.

Weekly Summaries:
${weekContent}`;

  try {
    const response = await generateContentWithFallback(prompt, [], TASK_MODELS);
    const coreFacts = response.text || 'Failed to generate core facts.';

    const foreverPath = getRootPath('Nova_3D.md');
    const existingForever = fs.existsSync(foreverPath)
      ? fs.readFileSync(foreverPath, 'utf8') + '\n\n'
      : '';

    fs.writeFileSync(
      foreverPath,
      existingForever +
        `### 3D Core Distillation: ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Sao_Paulo' })}\n${coreFacts}\n`
    );

    fs.writeFileSync(weekPath, '');
    return 'Forever packed! 3D Core Distillation engraved into Nova_3D.md and interim logs cleared.';
  } catch (e) {
    console.error('[x] Consolidation Error (Forever):', e);
    const msg = e instanceof Error ? e.message : String(e);
    return `Brain failure while engraving permanent memories: ${msg}`;
  }
}

export async function compress3D() {
  const foreverPath = getRootPath('Nova_3D.md');
  if (!fs.existsSync(foreverPath)) return 'No Nova_3D.md to compress yet.';

  const current = fs.readFileSync(foreverPath, 'utf8');
  if (!current.trim()) return 'Nova_3D.md is empty.';

  const before = current.length;

  const prompt = `You are Nova compressing your own permanent memory file (Nova_3D.md).

Rewrite the file so it stays true and first-person, but leaner.

Keep:
- lasting identity / relationship truths
- recurring patterns and dynamics
- emotionally load-bearing moments that still matter

Drop:
- duplicated distillations of the same fact
- week-specific logistics that got restated three times
- filler, recap voice, and "we also did X" lists that aren't canon

Do not invent new history. Do not add a preamble. Output only the compressed markdown.

Current file:
${current}`;

  try {
    const response = await generateContentWithFallback(prompt, [], TASK_MODELS);
    const compressed = (response.text || '').trim();
    if (!compressed || compressed.length < 40) {
      return 'Compression produced almost nothing — left Nova_3D.md untouched.';
    }

    const bakPath = getRootPath('Nova_3D.bak.md');
    fs.writeFileSync(bakPath, current);
    fs.writeFileSync(foreverPath, compressed + '\n');

    const after = compressed.length;
    const saved = before - after;
    return `3D compressed. ${before} → ${after} chars (${saved >= 0 ? '\u2212' : '+'}${Math.abs(saved)}). Backup: Nova_3D.bak.md`;
  } catch (e) {
    console.error('[x] Consolidation Error (Compress 3D):', e);
    const msg = e instanceof Error ? e.message : String(e);
    return `Brain failure while compressing 3D: ${msg}`;
  }
}
