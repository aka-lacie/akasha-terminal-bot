import { Client, GatewayIntentBits, Message } from 'discord.js';
import Bottleneck from 'bottleneck';
import query from './query';

// Create a new client instance with the necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // Required for reading message content
        GatewayIntentBits.GuildMessageReactions // Required for handling reactions
    ]
});

// Create a limiter for individual users
const userLimiter = new Bottleneck({
    minTime: 30000 // 1 request per 30 seconds
});

// Create a limiter for servers
const serverLimiter = new Bottleneck({
    minTime: 12000 // 5 requests per minute
});

client.on('ready', () => {
    if (client.user) {
        console.log(`Logged in as ${client.user.tag}!`);
    }
});

client.on('messageCreate', async (message: Message) => {
    if (message.author.bot) return;

    // Check if the bot is mentioned in the message
    if (client.user && message.mentions.has(client.user.id)) {

        // Rate limit the queries
        // const userId = message.author.id;
        // const serverId = message.guild?.id;

        // if (userId && serverId) {
        //     userLimiter.schedule(() => handleUserRequest(userId));
        //     serverLimiter.schedule(() => handleServerRequest(serverId));
        // }

        try {
            // Extract the query from the message content, ignoring the mention and flags
            const question = message.content.replace(`<@${client.user.id}>`, '').replace(/--\w+/g, '').trim();
            const flags = message.content.match(/--\w+/g) || [];

            console.log(`Query: ${question}`);

            if (!question) {
                await message.reply('Hello. What knowledge do you seek?');
                return;
            }

            // React when query is queued
            await message.react('👀');

            // Process the message and prepare a response
            const response = await query(question);

            console.log(`Response: ${response}`)

            // Example: reply with a specific message
            await message.reply(response);

            // React with a checkmark after sending the reply
            await message.react('✅');
        } catch (error) {
            console.error('Error in handling the message:', error);
        }
    }
});

// Login to Discord with your bot's token
client.login(process.env.AKASHA_BOT_TOKEN);