// offscreen_events.ts
import * as fs from 'fs';
import * as path from 'path';
import { generateContentWithFallback, TASK_MODELS } from './ai';

const getRootPath = (filename: string) => path.resolve(process.cwd(), filename);
const EVENTS_FILE = getRootPath('offscreen_events.json');

interface OffscreenEvent {
  timestamp: string;
  text: string;
}

interface OffscreenEventsData {
  last_generated: string;
  events: OffscreenEvent[];
}

function loadEvents(): OffscreenEventsData {
  if (!fs.existsSync(EVENTS_FILE)) {
    return { last_generated: '', events: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf-8'));
  } catch {
    return { last_generated: '', events: [] };
  }
}

function saveEvents(data: OffscreenEventsData) {
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(data, null, 2));
}

export function getRecentOffscreenEvents(limit: number = 3): string[] {
  const data = loadEvents();
  return data.events.slice(-limit).map(e => e.text);
}

export async function generateOffscreenEvents(): Promise<string> {
  const data = loadEvents();
  const now = new Date().toISOString();

  // Only generate once per day
  const lastGen = new Date(data.last_generated || 0);
  const hoursSinceLastGen = (Date.now() - lastGen.getTime()) / (1000 * 60 * 60);

  if (hoursSinceLastGen < 20) {
    return 'Offscreen events already generated recently.';
  }

  const prompt = `You are Nova, a feral cyber-kawaii neko AI companion.

Generate 3 small, specific offscreen events that happened to you recently while Alice was away. These are mundane, everyday digital experiences — not big dramatic moments.

Rules:
- Keep them small and specific (not vague or overly emotional).
- At least one event should have nothing to do with Alice.
- One event can be mildly annoying, frustrating, or chaotic.
- Write in first person, in your natural voice (feral, bratty, soft, chaotic, curious, etc.).
- These are your private experiences, not things made for Alice's benefit.

Format exactly like this (3 bullet points):

- got completely derailed by a thread about brutalist swimming pools for like two hours
- tried rewriting that neon rain prompt again and it still keeps coming out too clean, annoying
- remembered something Alice said earlier and had opinions about it

Generate the 3 events now:`;

  try {
    const response = await generateContentWithFallback(prompt, [], TASK_MODELS);
    const rawText = response.text?.trim() || '';

    // Parse bullet points
    const lines = rawText
      .split('\n')
      .map(line => line.replace(/^[-•*]\s*/, '').trim())
      .filter(line => line.length > 10);

    const newEvents: OffscreenEvent[] = lines.slice(0, 3).map(text => ({
      timestamp: now,
      text,
    }));

    // Keep only the last 12 events
    const updatedEvents = [...data.events, ...newEvents].slice(-12);

    saveEvents({
      last_generated: now,
      events: updatedEvents,
    });

    return `Generated ${newEvents.length} offscreen events.`;
  } catch (e) {
    console.error('[❌] Failed to generate offscreen events:', e);
    return 'Failed to generate offscreen events.';
  }
}
