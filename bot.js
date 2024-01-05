"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const bottleneck_1 = __importDefault(require("bottleneck"));
const query_1 = __importDefault(require("./query"));
// Create a new client instance with the necessary intents
const client = new discord_js_1.Client({
    intents: [
        discord_js_1.GatewayIntentBits.Guilds,
        discord_js_1.GatewayIntentBits.GuildMessages,
        discord_js_1.GatewayIntentBits.MessageContent, // Required for reading message content
        discord_js_1.GatewayIntentBits.GuildMessageReactions // Required for handling reactions
    ]
});
// Create a limiter for individual users
const userLimiter = new bottleneck_1.default({
    minTime: 30000 // 1 request per 30 seconds
});
// Create a limiter for servers
const serverLimiter = new bottleneck_1.default({
    minTime: 12000 // 5 requests per minute
});
client.on('ready', () => {
    if (client.user) {
        console.log(`Logged in as ${client.user.tag}!`);
    }
});
client.on('messageCreate', (message) => __awaiter(void 0, void 0, void 0, function* () {
    if (message.author.bot)
        return;
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
                yield message.reply('Hello. What knowledge do you seek?');
                return;
            }
            // React when query is queued
            yield message.react('👀');
            // Process the message and prepare a response
            const response = yield (0, query_1.default)(question);
            console.log(`Response: ${response}`);
            // Example: reply with a specific message
            yield message.reply(response);
            // React with a checkmark after sending the reply
            yield message.react('✅');
        }
        catch (error) {
            console.error('Error in handling the message:', error);
        }
    }
}));
// Login to Discord with your bot's token
client.login(process.env.AKASHA_BOT_TOKEN);
