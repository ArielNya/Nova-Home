export type ChatTurn = {
  role: 'user' | 'model';
  content: string;
  timestamp?: string;
};

export type ImagePart = {
  mimeType: string;
  data: string;
  url?: string;
};

/**
 * Structured chat prompt.
 * DeepSeek Responses uses a cache-stable prefix:
 *   instructions  = identity + tools hint   (almost never changes)
 *   input[0]      = system memory (3D+week) (changes on pack/compress)
 *   input[1..n]   = prior Alice/Nova turns
 *   last user     = [NOW] + current text + images  (hot, every turn)
 */
export type NovaPrompt = {
  kind: 'nova';
  instructions: string;
  memoryBlock: string;
  toolsHint: string;
  nowBlock: string;
  history: ChatTurn[];
  currentUserText: string;
  images?: ImagePart[];
  toolResult?: string;
};

export function isNovaPrompt(p: unknown): p is NovaPrompt {
  return !!p && typeof p === 'object' && (p as { kind?: string }).kind === 'nova';
}

/** Drop the current user turn if getContext already included the message we just saved. */
export function historyWithoutCurrent(history: ChatTurn[], currentText: string): ChatTurn[] {
  if (!history.length) return history;
  const last = history[history.length - 1];
  if (last.role === 'user' && last.content === currentText) {
    return history.slice(0, -1);
  }
  return history;
}

export function flattenNovaPrompt(p: NovaPrompt): string {
  const bits: string[] = [p.instructions];
  if (p.memoryBlock) bits.push(p.memoryBlock);
  if (p.toolsHint) bits.push(p.toolsHint);
  bits.push(p.nowBlock);

  let conversationStr = '\n';
  for (const entry of p.history) {
    const who = entry.role === 'user' ? 'Alice' : 'Nova';
    const ts = entry.timestamp ? `[${entry.timestamp} UTC] ` : '';
    conversationStr += `${ts}${who}: ${entry.content}\n`;
  }

  bits.push(`Here is our recent conversation context:${conversationStr}`);
  bits.push(`Alice just said: "${p.currentUserText}"\nNova:`);
  if (p.toolResult) bits.push(p.toolResult);
  return bits.join('\n\n');
}

function lastUserText(p: NovaPrompt): string {
  const parts = [p.nowBlock, `Alice: ${p.currentUserText}`];
  if (p.toolResult) parts.push(p.toolResult);
  return parts.join('\n\n');
}

function lastUserMessage(p: NovaPrompt, text: string, withImages: boolean): any {
  const images = withImages ? p.images || [] : [];
  if (!images.length) return { role: 'user', content: text };
  const content: any[] = [{ type: 'input_text', text }];
  for (const img of images) {
    const httpUrl = img.url && /^https?:\/\//i.test(img.url) ? img.url : '';
    if (httpUrl) {
      content.push({ type: 'input_image', image_url: httpUrl });
    } else {
      console.warn('[nova] skip image for responses: need an http url (data urls are too big)');
    }
  }
  return { role: 'user', content };
}

export function buildDeepSeekPayload(p: NovaPrompt): { instructions: string; input: any[] } {
  const instructions = [p.instructions, p.toolsHint].filter(Boolean).join('\n\n');
  const input: any[] = [];

  if (p.memoryBlock.trim()) {
    input.push({ role: 'system', content: p.memoryBlock });
  }

  for (const turn of p.history) {
    if (turn.role === 'user') {
      const ts = turn.timestamp ? `[${turn.timestamp} UTC] ` : '';
      input.push({ role: 'user', content: `${ts}${turn.content}` });
    } else {
      input.push({ role: 'assistant', content: turn.content });
    }
  }

  input.push(lastUserMessage(p, lastUserText(p), true));
  return { instructions, input };
}

/** Grok stored-chain follow-up: only the new turn (or tool result). Do not resend 3D/week/history. */
export function buildGrokFollowUpInput(p: NovaPrompt): any[] {
  if (p.toolResult) return [lastUserMessage(p, p.toolResult, false)];
  return [lastUserMessage(p, lastUserText(p), true)];
}

export function buildChatMessagesFromNovaPrompt(p: NovaPrompt): any[] {
  const system = [p.instructions, p.memoryBlock, p.toolsHint].filter(Boolean).join('\n\n');
  const messages: any[] = [{ role: 'system', content: system }];

  for (const turn of p.history) {
    messages.push({
      role: turn.role === 'user' ? 'user' : 'assistant',
      content: turn.content,
    });
  }

  const text = lastUserText(p);
  const images = p.images || [];
  if (!images.length) {
    messages.push({ role: 'user', content: text });
    return messages;
  }

  const content: any[] = [{ type: 'text', text }];
  for (const img of images) {
    const url =
      img.url && /^https?:\/\//i.test(img.url)
        ? img.url
        : `data:${img.mimeType};base64,${img.data}`;
    content.push({ type: 'image_url', image_url: { url } });
  }
  messages.push({ role: 'user', content });
  return messages;
}
