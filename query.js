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
Object.defineProperty(exports, "__esModule", { value: true });
const supabase_js_1 = require("@supabase/supabase-js");
const openai_1 = require("openai");
// MODELS
const EMBEDDING_MODEL = 'text-embedding-ada-002';
const GPT_MODEL = 'gpt-3.5-turbo-1106';
// CONFIG
const openai = new openai_1.OpenAI();
const supabase_url = process.env["AKASHA_SUPABASE_URL"] || '';
const supabase_key = process.env["AKASHA_SUPABASE_KEY"] || '';
const supabaseClient = (0, supabase_js_1.createClient)(supabase_url, supabase_key);
const systemPrompt = "You are the Akasha Terminal, a smart answer engine able to access the collective knowledge of Teyvat stored in the Irminsul database. Use the enumerated data provided to answer the given question, and cite sources referenced in your answer with brackets in the format `[id]`. Each piece of provided data may or may not be relevant to the question – discern using your best judgement and refuse questions outside of the scope of your data pertaining to Genshin Impact. If you cannot determine any answer, say so. Keep it concise - every word counts.";
// ============================================================
// SEARCH
// ============================================================
/**
 * Returns the embedding of the given query using OpenAI's embedding API.
 * @param query - The query to embed.
 * @returns A Promise that resolves to an array of numbers representing the embedding.
 */
const getQueryEmbedding = (query) => __awaiter(void 0, void 0, void 0, function* () {
    const response = yield openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: query,
    });
    return response.data[0].embedding;
});
/**
 * Retrieves related text from Supabase based on a given query.
 * @param query - The query to search for related text.
 * @param matchThreshold - The minimum similarity threshold for a match to be considered.
 * @param matchCount - The maximum number of matches to return.
 * @param minContentLength - The minimum length of the content to be considered.
 * @returns An array of tuples containing the related text and their similarity score.
 * @throws An error if there was an issue with the Supabase query.
 */
const getRelatedTextFromSupabase = (query, matchThreshold = 0.7, matchCount = 10, minContentLength = 100) => __awaiter(void 0, void 0, void 0, function* () {
    const queryEmbedding = yield getQueryEmbedding(query);
    const params = {
        embedding: queryEmbedding,
        match_threshold: matchThreshold,
        match_count: matchCount,
        min_content_length: minContentLength,
    };
    const { data, error } = yield supabaseClient.rpc('match_page_sections', params);
    if (error) {
        throw new Error(`PostgresError when querying Supabase: ${error.message}`);
    }
    return data.map((record) => [cleanText(record.content), record.similarity]);
});
// ============================================================
// POST-PROCESS SEARCH RESULTS
// ============================================================
/**
 * Removes unwanted characters and extra whitespace from a given string.
 * @param text - The string to be cleaned.
 * @returns The cleaned string.
 */
const cleanText = (text) => {
    return text.replace(/[\t]/g, ' ')
        .replace(/ +/g, ' ')
        .replace(/[=<>[\]{}|]/g, '')
        .trim();
};
// ============================================================
// ASK
// ============================================================
/**
 * Queries the Irminsul data to answer a given question.
 * @param query - The question to be answered.
 * @param relatedText - Optional related text. If not provided, runs a semantic search API call.
 * @param _model - Unused parameter.
 * @param _tokenBudget - Unused parameter.
 * @returns A string containing the brainstorming process, answer, and relevant Irminsul data.
 */
const queryMessage = (query, relatedText, _model, _tokenBudget) => __awaiter(void 0, void 0, void 0, function* () {
    const stringsAndRelatednesses = relatedText || (yield getRelatedTextFromSupabase(query));
    let message = '';
    message += '\n\nData:';
    for (let i = 0; i < stringsAndRelatednesses.length; i++) {
        const [string, _relatedness] = stringsAndRelatednesses[i];
        const nextArticle = `\n\n[${i + 1}] """"\n${string}\n""""`;
        message += nextArticle;
    }
    return message + `\n\nQuestion: "${query}"`;
});
/**
 * Asks a question to the Akasha Terminal and returns the response.
 * @param query - The question to ask.
 * @param relatedText - Optional related text to provide context for the question.
 * @param model - The OpenAI model to use for generating the response.
 * @param tokenBudget - The maximum number of tokens to use for generating the response.
 * @returns The response from the Akasha Terminal.
 * @throws An error if there was an issue with the OpenAI API call.
 */
const ask = (query, relatedText = null, model = GPT_MODEL, tokenBudget = 16385 - 500 - 489) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const message = yield queryMessage(query, relatedText, model, tokenBudget);
        const messages = [
            {
                role: 'system',
                content: systemPrompt,
            },
            {
                role: 'user',
                content: message,
            },
        ];
        const chatCompletion = yield openai.chat.completions.create({
            model: model,
            messages: messages,
            temperature: 0,
        });
        return chatCompletion.choices[0].message.content || '';
    }
    catch (err) {
        throw new Error(`Error when awaiting OpenAI completion: ${err.message}`);
    }
});
// ============================================================
// MAIN
// ============================================================
const sanitizeText = (text) => {
    return text
        .replace(/[;()\[\]{}]/g, '-')
        .replace(/[^a-zA-Z0-9'".,?:\- ]/g, '');
};
/**
 * Extract the first line of text, then any subsequent lines starting with '==' until no matches are found.
 * @param text
 * @returns An array of one or more titles
 */
const getTitlesFromText = (text) => {
    const lines = text.split('\n', 3).map(line => line.trim());
    let titles = [lines[0]];
    for (let line in lines) {
        if (line && line.startsWith('==')) {
            titles.push(line.replace(/=/g, '').trim());
        }
        else {
            break;
        }
    }
    return titles;
};
const getURLFromTitles = (titles) => {
    const prefix = 'https://genshin-impact.fandom.com/wiki/';
    const pagetitle = titles[0].replace(/ /g, '_');
    const sectiontitle = titles.length > 1 ? titles[1].replace(/ /g, '_') : '';
    return `${prefix}${pagetitle}#${sectiontitle}`;
};
// const logQA = async (query: string, response: string) => {
//   await supabaseClient.from('query_logs').insert([
//     { user_query: query, llm_answer: response }
//   ])
// }
const query = (question) => __awaiter(void 0, void 0, void 0, function* () {
    const sanitizedQuestion = sanitizeText(question);
    const searchData = yield getRelatedTextFromSupabase(sanitizedQuestion);
    let response = yield ask(sanitizedQuestion, searchData);
    const citations = response.match(/\[\d+\]/g) || [];
    const citationIds = citations.map(citation => parseInt(citation.replace(/\[|\]/g, '')));
    const citationMap = new Map();
    for (let id of citationIds) {
        if (id > searchData.length)
            continue;
        const url = getURLFromTitles(getTitlesFromText(searchData[id - 1][0]));
        if (!Array.from(citationMap.values()).some(value => value === url)) {
            citationMap.set(`[${id}]`, url);
        }
        else {
            response = response.replace(`[${id}]`, '');
        }
    }
    let index = 1;
    for (let [citation, url] of citationMap) {
        const markupLink = `[[${index}]](${url})`;
        response = response.replace(citation, markupLink);
        index++;
    }
    // await logQA(query, response)
    return response;
});
exports.default = query;
