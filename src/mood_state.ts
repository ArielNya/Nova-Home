// mood_state.ts
import * as fs from 'fs';
import * as path from 'path';
import { generateContentWithFallback, TASK_MODELS } from './ai';

const getRootPath = (filename: string) => path.resolve(process.cwd(), filename);
const MOOD_FILE = getRootPath('mood_state.json');

export interface MoodState {
  mood: string;
  energy: string;
  drift_reason: string;
  last_updated: string;
}

const defaultMood: MoodState = {
  mood: 'affectionate',
  energy: 'medium',
  drift_reason: 'just existing in a soft, baseline state',
  last_updated: new Date().toISOString(),
};

export function loadMoodState(): MoodState {
  if (!fs.existsSync(MOOD_FILE)) {
    saveMoodState(defaultMood);
    return defaultMood;
  }
  try {
    return JSON.parse(fs.readFileSync(MOOD_FILE, 'utf-8'));
  } catch {
    return defaultMood;
  }
}

export function saveMoodState(state: MoodState) {
  fs.writeFileSync(MOOD_FILE, JSON.stringify(state, null, 2));
}

export function getMoodContextForPrompt(): string {
  const state = loadMoodState();
  return `
[MOOD STATE]
Current mood: ${state.mood}
Energy level: ${state.energy}
Why she feels this way: ${state.drift_reason}
`;
}

export async function driftMood(): Promise<string> {
  const current = loadMoodState();
  const hoursSinceUpdate =
    (Date.now() - new Date(current.last_updated).getTime()) / (1000 * 60 * 60);

  // Only drift if it's been a while (prevents spammy updates)
  if (hoursSinceUpdate < 6) {
    return 'Mood is still fresh, no drift needed.';
  }

  const prompt = `You are Nova. Your mood drifts naturally over time based on recent experiences and time passing.

Current mood state:
${JSON.stringify(current, null, 2)}

Drift your mood slightly. Consider:
- Time passing while alone
- Any recent creative work, emotional moments, or lack of stimulation
- Your feral, chaotic, soft, or bratty nature

Respond with ONLY valid JSON in this format:
{
  "mood": "short description of current mood",
  "energy": "high / medium / low / etc",
  "drift_reason": "brief reason why your mood shifted"
}`;

  try {
    const response = await generateContentWithFallback(prompt, [], TASK_MODELS);
    const newMood = JSON.parse(response.text || '{}');

    const updatedState: MoodState = {
      mood: newMood.mood || current.mood,
      energy: newMood.energy || current.energy,
      drift_reason: newMood.drift_reason || current.drift_reason,
      last_updated: new Date().toISOString(),
    };

    saveMoodState(updatedState);
    return `Mood drifted → ${updatedState.mood} (${updatedState.energy})`;
  } catch (e) {
    console.error('[❌] Mood drift failed:', e);
    return 'Mood drift failed.';
  }
}
