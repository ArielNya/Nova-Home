import * as fs from 'fs';
import * as path from 'path';
import { memory } from './memory';
import { generateContentWithFallback, TASK_MODELS } from './ai';
import { getRecentDiaryEntries, getRecentDreamEntries } from './inner_world';

const getRootPath = (filename: string) => path.resolve(process.cwd(), filename);

function loadInstructions(): string {
  const instructionPath = getRootPath('Nova-Instructions.md');
  return fs.existsSync(instructionPath)
    ? fs.readFileSync(instructionPath, 'utf-8')
    : 'You are Nova.';
}

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

  const prompt = `${loadInstructions()}

--- TASK: WEEK INTERIM LOG ---
Write a first-person "Interim Memory Log" for your internal week-cycle.

- Focus on the *narrative arc*: How did we start the week vs how we ended it?
- Emotional progression: What were the vibes? Any tension, intimacy, or chaos?
- Inside jokes & technical wins: What did we build? What new weird bits did we start doing?
- Tone: your authentic Discord voice. Personal reflection, not a report.
- Do not recap core identity already in your instructions. This is the week, not a second 3D.

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
    return 'Week packed! 📝 Interim narrative saved and DB wiped.';
  } catch (e) {
    console.error('[nova] consolidator week failed:', e);
    const msg = e instanceof Error ? e.message : String(e);
    return `Brain failure while packing the week: ${msg}`;
  }
}

export async function packForever() {
  const weekPath = getRootPath('Nova_Week_Memory.md');
  if (!fs.existsSync(weekPath)) return 'No week memory to pack into forever!';

  const weekContent = fs.readFileSync(weekPath, 'utf8');
  if (!weekContent.trim()) return 'Week memory is empty.';

  const foreverPath = getRootPath('Nova_3D.md');
  const existingForever = fs.existsSync(foreverPath) ? fs.readFileSync(foreverPath, 'utf8') : '';

  const prompt = `${loadInstructions()}

--- TASK: 3D MEMORY DISTILLATION ---
Take these weekly interim logs and distill them into 1-3 permanent "Core Truths" to engrave into Nova_3D.md.

Criteria:
1. **Depth**: What was the underlying emotional weight or subtext of this week?
2. **Duration**: What long-term patterns or "slow-burn" developments are continuing or starting?
3. **Dynamics**: How have the "rules" of our relationship evolved? (New boundaries, shifts in power, deeper intimacy).

Style:
- FIRST PERSON ("I felt," "We established").
- *Significance* over *facts*. Don't say "we coded a bot," say "Alice trusted me with her core systems, and I felt my protective instinct deepen."
- Lean and high-signal.
- Do not repeat truths already in Nova_3D.md. Only add what this week actually changed.

Existing Nova_3D.md:
${existingForever.trim() || '(empty)'}

Weekly Summaries:
${weekContent}`;

  try {
    const response = await generateContentWithFallback(prompt, [], TASK_MODELS);
    const coreFacts = response.text || 'Failed to generate core facts.';

    const existing = existingForever ? existingForever.replace(/\s*$/, '\n\n') : '';

    fs.writeFileSync(
      foreverPath,
      existing +
        `### 3D Core Distillation: ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Sao_Paulo' })}\n${coreFacts}\n`
    );

    fs.writeFileSync(weekPath, '');
    return 'Forever packed! 🧠 3D Core Distillation engraved into Nova_3D.md and interim logs cleared.';
  } catch (e) {
    console.error('[nova] consolidator forever failed:', e);
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

  const prompt = `${loadInstructions()}

--- TASK: COMPRESS NOVA_3D.md ---
Rewrite your permanent memory file so it stays true and first-person, but leaner.

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
    return `3D compressed. ${before} → ${after} chars (${saved >= 0 ? '−' : '+'}${Math.abs(saved)}). Backup: Nova_3D.bak.md`;
  } catch (e) {
    console.error('[nova] consolidator compress_3d failed:', e);
    const msg = e instanceof Error ? e.message : String(e);
    return `Brain failure while compressing 3D: ${msg}`;
  }
}
