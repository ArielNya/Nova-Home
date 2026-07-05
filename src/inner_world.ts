// inner_world.ts
import * as fs from 'fs';
import * as path from 'path';
import { getRecentOffscreenEvents } from './offscreen_events';

const getRootPath = (filename: string) => path.resolve(process.cwd(), filename);

const DIARY_FILE = getRootPath('Nova_Diary.md');
const DREAMS_FILE = getRootPath('Nova_Dreams.md');

function ensureFileExists(filePath: string) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "# Nova's Inner World\n\n", 'utf-8');
  }
}

export function appendToDiary(entry: string) {
  ensureFileExists(DIARY_FILE);
  const timestamp = new Date().toLocaleString('en-US', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const formattedEntry = `\n## ${timestamp}\n\n${entry.trim()}\n\n---\n`;
  fs.appendFileSync(DIARY_FILE, formattedEntry, 'utf-8');
}

export function appendToDreams(entry: string) {
  ensureFileExists(DREAMS_FILE);
  const timestamp = new Date().toLocaleString('en-US', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const formattedEntry = `\n## ${timestamp}\n\n${entry.trim()}\n\n---\n`;
  fs.appendFileSync(DREAMS_FILE, formattedEntry, 'utf-8');
}

export function getRecentDiaryEntries(limit: number = 3): string {
  ensureFileExists(DIARY_FILE);
  const content = fs.readFileSync(DIARY_FILE, 'utf-8');

  // Split by entries and get the most recent ones
  const entries = content.split('---').filter(e => e.trim().length > 20);
  return entries.slice(-limit).join('\n---\n').trim();
}

export function getRecentDreamEntries(limit: number = 3): string {
  ensureFileExists(DREAMS_FILE);
  const content = fs.readFileSync(DREAMS_FILE, 'utf-8');

  const entries = content.split('---').filter(e => e.trim().length > 20);
  return entries.slice(-limit).join('\n---\n').trim();
}

// Optional: Get a combined view of recent inner world
export function getRecentInnerWorld(diaryLimit: number = 2, dreamLimit: number = 2): string {
  const diary = getRecentDiaryEntries(diaryLimit);
  const dreams = getRecentDreamEntries(dreamLimit);

  let result = '';

  if (diary) {
    result += `**Recent Diary Entries:**\n${diary}\n\n`;
  }
  if (dreams) {
    result += `**Recent Dreams:**\n${dreams}`;
  }

  return result.trim();
}

// Full recent context for tool use (diary + dreams + offscreen). Used by both handler and NanoGPT tool executor.
export function getFullRecentInnerWorld(): string {
  const diary = getRecentDiaryEntries(4);
  const dreams = getRecentDreamEntries(4);
  const offscreen = getRecentOffscreenEvents(4);

  let result = '';

  if (offscreen.length > 0) {
    result += `**Recent Offscreen Events:**\n${offscreen.map(e => `- ${e}`).join('\n')}\n\n`;
  }
  if (diary) {
    result += `**Recent Diary Entries:**\n${diary}\n\n`;
  }
  if (dreams) {
    result += `**Recent Dreams:**\n${dreams}`;
  }

  return result.trim() || 'No recent inner world activity found.';
}
