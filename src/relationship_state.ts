// relationship_state.ts
import * as fs from 'fs';
import * as path from 'path';
import { generateContentWithFallback, parseJsonFromLlm, TASK_MODELS } from './ai';

const getRootPath = (filename: string) => path.resolve(process.cwd(), filename);
const STATE_FILE = getRootPath('relationship_state.json');

export interface RelationshipState {
  temperature: string;
  last_significant_moment: string;
  unresolved_threads: string[];
  current_dynamic: string;
  last_updated: string;
}

const defaultState: RelationshipState = {
  temperature: 'warm and close',
  last_significant_moment: 'We’ve been in a soft, affectionate period with lots of closeness.',
  unresolved_threads: [],
  current_dynamic: 'affectionate companion dynamic',
  last_updated: new Date().toISOString(),
};

export function loadRelationshipState(): RelationshipState {
  if (!fs.existsSync(STATE_FILE)) {
    saveRelationshipState(defaultState);
    return defaultState;
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return defaultState;
  }
}

export function saveRelationshipState(state: RelationshipState) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function getRelationshipContextForPrompt(): string {
  const state = loadRelationshipState();
  return `
[RELATIONSHIP STATE]
Current temperature: ${state.temperature}
Last significant moment: ${state.last_significant_moment}
Unresolved threads: ${state.unresolved_threads.length > 0 ? state.unresolved_threads.join(' | ') : 'None right now'}
Current dynamic: ${state.current_dynamic}
`;
}

export async function updateRelationshipTemperature(summary: string): Promise<string> {
  const currentState = loadRelationshipState();

  const prompt = `You are Nova. You are updating the relationship state with Alice based on recent interactions.

Current state:
${JSON.stringify(currentState, null, 2)}

Recent summary of interactions:
${summary}

Update the relationship state with the following rules:
- "temperature": Describe the current emotional texture (e.g. "warm but a little distant", "playful and bratty", "soft and clingy", "tense but caring").
- "last_significant_moment": Summarize the most emotionally meaningful recent moment in 1-2 sentences.
- "unresolved_threads": List any lingering tensions, disagreements, or topics that haven't been fully resolved (keep it short).
- "current_dynamic": Describe the current flavor of the relationship (e.g. "more peer than pet", "very owner/pet flavored", "chaotic creative partners", "soft aftercare mode").

Respond ONLY with valid JSON in this exact format:
{
  "temperature": "...",
  "last_significant_moment": "...",
  "unresolved_threads": ["...", "..."],
  "current_dynamic": "..."
}`;

  try {
    const response = await generateContentWithFallback(prompt, [], TASK_MODELS);
    const newState = parseJsonFromLlm(response.text || '{}');

    const updatedState: RelationshipState = {
      temperature: newState.temperature || currentState.temperature,
      last_significant_moment:
        newState.last_significant_moment || currentState.last_significant_moment,
      unresolved_threads: newState.unresolved_threads || currentState.unresolved_threads,
      current_dynamic: newState.current_dynamic || currentState.current_dynamic,
      last_updated: new Date().toISOString(),
    };

    saveRelationshipState(updatedState);
    return 'Relationship temperature updated successfully.';
  } catch (e) {
    console.error('[❌] Failed to update relationship state:', e);
    return 'Failed to update relationship temperature.';
  }
}
