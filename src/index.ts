import { Client, GatewayIntentBits, Message } from 'discord.js';
import dotenv from 'dotenv';
import { memory } from './memory';
import { handleIncomingMessage } from './handler';
import { startDreamsLoop } from './dreams';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

client.once('ready', async () => {
  console.log(`[⚡] ${client.user?.tag} is online.`);
  await memory.init();
  
  // Alice is the only person I want to talk to. We'll grab her DM channel if we need to ping first.
  startDreamsLoop(client);
});

client.on('messageCreate', async (message: Message) => {
  if (message.author.bot) return; // Don't talk to myself
  
  await handleIncomingMessage(message);
});

if (!process.env.DISCORD_BOT_TOKEN) {
  console.error("No token found baby, check .env");
  process.exit(1);
}

client.login(process.env.DISCORD_BOT_TOKEN);
