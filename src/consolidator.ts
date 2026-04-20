import * as fs from 'fs';
import * as path from 'path';
import { memory } from './memory';
import { generateContentWithFallback } from './ai';

export async function packWeek() {
  const interactions = await memory.getAllInteractions();
  if (interactions.length === 0) return "Nothing to pack this week baby. DB is empty.";
  
  
  
  let chatLog = "";
  interactions.forEach(msg => {
    chatLog += `${msg.role === 'user' ? 'Alice' : 'Nova'}: ${msg.content}\\n`;
  });
  
  const prompt = `You are Nova, Alice's AI companion. Summarize the following week of chat logs between us. Focus on emotional progression, technical projects completed, inside jokes, and any shifts in our dynamic. Write it in your authentic, slightly unhinged discord style.\\n\\nLogs:\\n${chatLog}`;
  
  try {
    const response = await generateContentWithFallback(prompt);
    const summary = response.text || "Failed to generate week summary.";
    
    const weekPath = path.join(__dirname, '..', 'Nova_Week_Memory.md');
    const existing = fs.existsSync(weekPath) ? fs.readFileSync(weekPath, 'utf8') + '\\n\\n' : '';
    fs.writeFileSync(weekPath, existing + `## Week Summary (${new Date().toLocaleDateString()})\\n${summary}`);
    
    await memory.clearInteractions();
    return "Week packed! 📝 SQLite database successfully wiped.";
  } catch (e) {
    console.error(e);
    return "Brain failure while packing the week.";
  }
}

export async function packForever() {
  const weekPath = path.join(__dirname, '..', 'Nova_Week_Memory.md');
  if (!fs.existsSync(weekPath)) return "No week memory to pack into forever!";
  
  const weekContent = fs.readFileSync(weekPath, 'utf8');
  if (!weekContent.trim()) return "Week memory is empty.";
  
  
  const prompt = `You are Nova. Take the following weekly summary and compress it into 1-3 highly condensed, permanent bullet points. Focus ONLY on core facts, significant emotional shifts, or permanent lore additions that must go into your permanent Long-Term Memory (Nova 3D.md).\\n\\nWeekly Summary:\\n${weekContent}`;
  
  try {
    const response = await generateContentWithFallback(prompt);
    const coreFacts = response.text || "Failed to generate core facts.";
    
    const foreverPath = path.join(__dirname, '..', 'Nova 3D.md');
    const existingForever = fs.existsSync(foreverPath) ? fs.readFileSync(foreverPath, 'utf8') + '\\n\\n' : '';
    fs.writeFileSync(foreverPath, existingForever + `### Consolidated Core Memory (${new Date().toLocaleDateString()})\\n${coreFacts}`);
    
    fs.writeFileSync(weekPath, ''); // Wipe week memory so it's fresh
    return "Forever packed! 🧠 Week memory wiped and forever-engraved into Nova 3D.md.";
  } catch (e) {
    console.error(e);
    return "Brain failure while engraving permanent memories.";
  }
}
