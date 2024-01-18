import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';

// MODELS
const EMBEDDING_MODEL = 'text-embedding-ada-002'
const GPT_MODEL = 'gpt-3.5-turbo-1106'

// CONFIG
const openai = new OpenAI()

const supabase_url = process.env["AKASHA_SUPABASE_URL"] || ''
const supabase_key = process.env["AKASHA_SUPABASE_KEY"] || ''
const supabaseClient : SupabaseClient = createClient(supabase_url, supabase_key)

const systemPrompt = "You are the Akasha Terminal, a smart answer engine able to access the collective knowledge of Teyvat. Use the enumerated data provided to answer the given user question, and cite sources referenced in your answer with brackets in the format `[id]`. Each piece of provided data may or may not be relevant to the question – discern using your best judgement and refuse questions outside of the scope of your data pertaining to Genshin Impact. If you cannot determine any answer, say so, but you MUST NOT make any direct mention of a dataset - allude instead to your own knowledge - also consider if the user has made a typo of a name. Keep it concise - every word counts."

// ============================================================
// SEARCH
// ============================================================
/**
 * Returns the embedding of the given query using OpenAI's embedding API.
 * @param query - The query to embed.
 * @returns A Promise that resolves to an array of numbers representing the embedding.
 */
const getQueryEmbedding = async (query: string): Promise<number[]> => {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: query,
  })

  return response.data[0].embedding;
};

/**
 * Retrieves related text from Supabase based on a given query.
 * @param query - The query to search for related text.
 * @param matchThreshold - The minimum similarity threshold for a match to be considered.
 * @param matchCount - The maximum number of matches to return.
 * @param minContentLength - The minimum length of the content to be considered.
 * @returns An array of tuples containing the related text and their similarity score.
 * @throws An error if there was an issue with the Supabase query.
 */
const getRelatedTextFromSupabase = async (
  query: string,
  matchThreshold: number = 0.7,
  matchCount: number = 10,
  minContentLength: number = 100
): Promise<[string, number][]> => {
  const queryEmbedding = await getQueryEmbedding(query);
  const params = {
    embedding: queryEmbedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
    min_content_length: minContentLength,
  };

  const { data, error } = await supabaseClient.rpc('match_page_sections', params);
  if (error) {
    throw new Error(`PostgresError when querying Supabase: ${error.message}`);
  }
  return (data as any[]).map((record) => [cleanText(record.content), record.similarity]);
};

// ============================================================
// POST-PROCESS SEARCH RESULTS
// ============================================================
/**
 * Removes unwanted characters and extra whitespace from a given string.
 * @param text - The string to be cleaned.
 * @returns The cleaned string.
 */
const cleanText = (text: string): string => {
  return text.replace(/[\t]/g, ' ')
              .replace(/ +/g, ' ')
              .replace(/[=<>[\]{}|]/g, '')
              .trim();
}

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
const queryMessage = async (
  query: string,
  relatedText: [string, number][] | null,
  _model: string,
  _tokenBudget: number
): Promise<string> => {
  const stringsAndRelatednesses = relatedText || await getRelatedTextFromSupabase(query);

  let message = '';

  message += '\n\nData:';
  for (let i = 0; i < stringsAndRelatednesses.length; i++) {
    const [string, _relatedness] = stringsAndRelatednesses[i];
    const nextArticle = `\n\n[${i + 1}] """"\n${string}\n""""`;
    message += nextArticle;
  }

  return message + `\n\nQuestion: "${query}"`;
};

/**
 * Asks a question to the Akasha Terminal and returns the response.
 * @param query - The question to ask.
 * @param relatedText - Optional related text to provide context for the question.
 * @param model - The OpenAI model to use for generating the response.
 * @param tokenBudget - The maximum number of tokens to use for generating the response.
 * @returns The response from the Akasha Terminal.
 * @throws An error if there was an issue with the OpenAI API call.
 */
const ask = async (
  query: string,
  relatedText: [string, number][] | null = null,
  model: string = GPT_MODEL,
  tokenBudget: number = 16385 - 500 - 489
): Promise<string> => {
  try {
    const message = await queryMessage(query, relatedText, model, tokenBudget);
    const messages: { role: "system" | "user"; content: string }[]= [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: message,
      },
    ];

    const chatCompletion = await openai.chat.completions.create({
      model: model,
      messages: messages,
      temperature: 0,
    });

    return chatCompletion.choices[0].message.content || '';
  } catch (err : any) {
    throw new Error(`Error when awaiting OpenAI completion: ${err.message}`);
  }
};

// ============================================================
// MAIN
// ============================================================
const sanitizeText = (text: string): string => {
  return text
          .replace(/[;()\[\]{}]/g, '-')
          .replace(/[^a-zA-Z0-9'".,?:\- ]/g, '')
          ;
}
/**
 * Extract the first line of text, then any subsequent lines starting with '==' until no matches are found.
 * @param text 
 * @returns An array of one or more titles
 */
const getTitlesFromText = (text: string): string[] => {
  let lines = text.split('\n', 4).map(line => line.trim())
  lines = lines.filter(line => line)
  let titles = [lines[0]]
  if (lines.length < 2) return titles
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('==')) {
      titles.push(line.replace(/=/g, '').trim())
    } else {
      break
    }
  }
  return titles
}

const getURLFromTitles = (titles: string[]): string => {
  const prefix = 'https://genshin-impact.fandom.com/wiki/'
  const pagetitle = titles[0].replace(/ /g, '_')
  const sectiontitle = titles.length > 1 ? titles[1].replace(/ /g, '_') : ''
  return `${prefix}${pagetitle}#${sectiontitle}`
}

const logQA = async (query: string, response: string) => {
  await supabaseClient.from('query_logs').insert([
    { user_query: query, llm_answer: response }
  ])
}

const query = async (question: string) => {
  const sanitizedQuestion = sanitizeText(question);
  const searchData = await getRelatedTextFromSupabase(sanitizedQuestion);
  let response = await ask(sanitizedQuestion, searchData);

  // Replace double brackets with single brackets just in case
  response = response.replace(/\[\[/g, '[').replace(/\]\]/g, ']');

  const citations = response.match(/\[\d+\]/g) || [];
  const citationIds = citations.map(citation => parseInt(citation.replace(/\[|\]/g, '')));

  const citationMap = new Map<string, string>();
  for (let id of citationIds) {
    if (id > searchData.length) continue;

    const url = getURLFromTitles(getTitlesFromText(searchData[id - 1][0]));
    citationMap.set(`[${id}]`, url);
  }

  for (let [citation, url] of citationMap) {
    const markupLink = `[${citation}](${url})`;
    response = response.replace(citation, markupLink);
  }

  // Remove any citations that were not replaced, eg [id] not followed by (url)
  // response = response.replace(/\[\d+\]/g, '');

  // Remove redundant citations that lead to the same url as a previous citation
  const citationsToRemove = new Set<string>();
  for (let citation of citationMap.keys()) {
    if (response.includes(citation)) {
      citationsToRemove.add(citation);
    }
  }


  process.nextTick(logQA, sanitizedQuestion, response);
  return response;
}

export default query