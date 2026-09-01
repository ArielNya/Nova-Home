import * as fs from 'fs';
import * as path from 'path';

const getRootPath = (filename: string) => path.resolve(process.cwd(), filename);

function readCanon(filename: string, label: string): string {
  const p = getRootPath(filename);
  if (!fs.existsSync(p)) return '';
  const text = fs.readFileSync(p, 'utf-8').trim();
  return text ? `--- ${label} ---\n${text}` : '';
}

export function getVisualCanon(who: string = 'both'): string {
  const w = (who || 'both').toLowerCase().trim();
  const wantAlice = w === 'both' || w === 'alice' || w === 'us' || w === 'her';
  const wantNova = w === 'both' || w === 'nova' || w === 'me' || w === 'self';

  const parts: string[] = [];
  if (wantAlice) {
    const alice = readCanon('ALICE_APPEARANCE.md', 'ALICE APPEARANCE');
    if (alice) parts.push(alice);
  }
  if (wantNova) {
    const nova = readCanon('NOVA_APPEARANCE.md', 'NOVA APPEARANCE');
    if (nova) parts.push(nova);
  }

  if (!parts.length) {
    return 'No appearance files found for that subject.';
  }
  return parts.join('\n\n');
}

/** True when Alice is asking for an image prompt / visual canon, not ordinary chat. */
export function wantsVisualCanon(message: string): boolean {
  return /\b(image prompt|img prompt|draw prompt|art prompt|grok prompt|imagine prompt|midjourney|visual canon|visual description|appearance (file|canon)|character sheet|reference sheet|write (me )?(an? )?(image |art |draw )?prompt|gera(r)? (um )?(image |art )?prompt|faz (um )?prompt (de |pra |para |pro )?(imagem|desenho|grok|imagine)|prompt de (imagem|desenho|grok|imagine)|prompt (pra|para|pro) (o )?(imagem|desenho|grok|imagine)|canon visual|como (voc[eê]|eu|a nova) (parece|t[aá] vestid)|looks like (me|you|her|nova|alice)|describe (my|your|our|her) (look|appearance|outfit)|descreve (como |minha |sua |a minha |a sua )?(apar[eê]ncia|roupa|look))\b/i.test(
    message
  );
}

export function parseWhoFromText(text: string): string {
  const m =
    text.match(/["']who["']\s*:\s*["'](\w+)["']/i) ||
    text.match(/\bwho\s*[=:]\s*(\w+)/i);
  if (!m) return 'both';
  const w = m[1].toLowerCase();
  if (w === 'alice' || w === 'nova' || w === 'both' || w === 'me' || w === 'her') return w;
  return 'both';
}
