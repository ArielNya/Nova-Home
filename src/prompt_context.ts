import { loadMoodState } from './mood_state';
import { loadRelationshipState } from './relationship_state';
import { getDiaryResidue, getDreamResidue } from './inner_world';
import { getRecentOffscreenEvents } from './offscreen_events';

export function buildNowBlock(hoursAlone: number): string {
  const mood = loadMoodState();
  const rel = loadRelationshipState();
  const diary = getDiaryResidue();
  const dream = getDreamResidue();
  const off = getRecentOffscreenEvents(1)[0] || '';
  const thread = rel.unresolved_threads[0] || 'none';

  const lines = [
    '[NOW]',
    `mood: ${mood.mood} | energy: ${mood.energy}`,
    `why: ${mood.drift_reason}`,
    `rel: ${rel.temperature} | dynamic: ${rel.current_dynamic}`,
    `open thread: ${thread}`,
  ];
  if (diary) lines.push(`residue: ${diary}`);
  if (dream) lines.push(`dream-image: ${dream}`);
  if (off) lines.push(`offscreen: ${off}`);
  lines.push(`alone: ${hoursAlone.toFixed(1)}h`);
  return lines.join('\n');
}
