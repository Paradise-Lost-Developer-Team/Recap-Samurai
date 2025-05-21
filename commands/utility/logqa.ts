import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { MESSAGE_LOG } from '../../utils/digest';
import { GoogleGenAI, HarmCategory, SafetySetting } from '@google/genai';
import fs from 'fs';
import path from 'path';

const configPath = path.resolve(process.cwd(), 'data', 'config.json');
const { GEMINI_API_KEY, GEMINI_MODEL_ID, ALTERNATE_GEMINI_MODEL_ID, ALTERNATE_MODEL_UNTIL } = JSON.parse(
    fs.readFileSync(configPath, 'utf-8')
);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

export const data = new SlashCommandBuilder()
    .setName('logqa')
    .setDescription('メッセージログに基づくQAチャット')
    .addStringOption(option =>
        option.setName('question').setDescription('質問内容').setRequired(true)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    const question = interaction.options.getString('question', true);
    const guildId = interaction.guildId!;
    const messages = (MESSAGE_LOG.get(guildId) || []) as { content: string; author: string; timestamp: number }[];
    // 直近だけでなく全期間のメッセージを対象にする
    const context = messages.map(m => `${m.author}: ${m.content}`).join('\n');
    const prompt = `あなたはDiscordのメッセージ履歴を熟知したAIです。以下の履歴を参考に、ユーザーの質問に日本語で簡潔かつ正確に答えてください。\n\n【履歴】\n${context}\n\n【質問】${question}\n\n【答え】`;
    const generationConfig = {
        maxOutputTokens: 1024,
        temperature: 0.2,
        topP: 0.95,
        responseModalities: ['TEXT'],
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: 'OFF' },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: 'OFF' },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: 'OFF' },
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: 'OFF' },
        ] as SafetySetting[],
    };
    let isAlternate = false;
    if (ALTERNATE_MODEL_UNTIL) {
        isAlternate = new Date() < new Date(ALTERNATE_MODEL_UNTIL);
    }
    const model = isAlternate ? ALTERNATE_GEMINI_MODEL_ID : GEMINI_MODEL_ID;
    let generated = '';
    const stream = await ai.models.generateContentStream({ model, contents: [prompt], config: generationConfig });
    for await (const chunk of stream) {
        if (chunk.text) generated += chunk.text;
    }
    await interaction.reply({ content: generated || '履歴から答えを生成できませんでした。', ephemeral: true });
}
