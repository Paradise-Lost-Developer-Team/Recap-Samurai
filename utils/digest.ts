// 要約侍 - digest.ts
// 機能: 週次ダイジェスト & キーワードアラート

import { ExtendedClient } from '../index';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { GoogleGenAI, HarmCategory, SafetySetting } from '@google/genai';
        
const dataDir = path.resolve(process.cwd(), 'data');
const configPath = path.join(dataDir, 'config.json');
    
// config読み込み (Gemini 設定)
const { GEMINI_API_KEY, GEMINI_MODEL_ID, ALTERNATE_GEMINI_MODEL_ID } = JSON.parse(
    fs.readFileSync(configPath, 'utf-8')
);
// GoogleGenAI クライアント初期化
const ai = new GoogleGenAI({
    apiKey: GEMINI_API_KEY
});
// prompt テンプレート読み込み
const promptTemplate = fs.readFileSync(path.resolve(process.cwd(), 'utils', 'prompt_digest.txt'), 'utf-8');

const KEYWORDS = ['緊急', 'トラブル', '質問'];
export const MESSAGE_LOG = new Map<string, { content: string; author: string; timestamp: number }[]>();

export function setupDigestBot(client: ExtendedClient) {
    // メッセージログをメモリ上で管理 (永続化廃止)

    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;

        const guildId = message.guildId!;
        const log = MESSAGE_LOG.get(guildId) || [];
        log.push({
            content: message.content,
            author: message.author.tag,
            timestamp: message.createdTimestamp,
        });
        MESSAGE_LOG.set(guildId, log);

        if (KEYWORDS.some((kw) => message.content.includes(kw))) {
            const hit = KEYWORDS.find((kw) => message.content.includes(kw));
            await message.reply(`⚠️ キーワード「${hit}」が検出されました。`);
        }
    });

    // configからcron式とチャンネルIDを取得
    let digestCron = '0 0 7 * * 1';
    let digestChannelId = null;
    let ALTERNATE_MODEL_UNTIL = null;
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.DIGEST_CRON) digestCron = config.DIGEST_CRON;
        if (config.DIGEST_CHANNEL_ID) digestChannelId = config.DIGEST_CHANNEL_ID;
        if (config.ALTERNATE_MODEL_UNTIL) ALTERNATE_MODEL_UNTIL = config.ALTERNATE_MODEL_UNTIL;
    } catch {}

    cron.schedule(digestCron, async () => {
        for (const [guildId, messages] of MESSAGE_LOG.entries()) {
            if (messages.length === 0) continue;
            const guild = await client.guilds.fetch(guildId);
            let channel = null;
            if (digestChannelId) {
                try {
                    channel = await guild.channels.fetch(digestChannelId);
                } catch {}
            }
            if (!channel || !channel.isTextBased?.()) {
                channel = guild.systemChannel || (await guild.channels.fetch()).find((c) => c?.isTextBased?.());
            }
            if (!channel || !channel.isTextBased?.()) continue;

            const summaryText = messages.map((m) => `${m.author}: ${m.content}`).join('\n');
            const promptInput = `${promptTemplate}\n\n${summaryText}`;
            const generationConfig = {
                maxOutputTokens: 8192,
                temperature: 1,
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
            const stream = await ai.models.generateContentStream({ model, contents: [promptInput], config: generationConfig });
            for await (const chunk of stream) {
                if (chunk.text) generated += chunk.text;
            }
            const digest = generated || '要約に失敗しました';
            const MAX_LEN = 2000;
            const prefix = '📝 **要約侍による週次ダイジェスト**\n';
            for (let i = 0; i < digest.length; i += MAX_LEN) {
                await channel.send(prefix + digest.slice(i, i + MAX_LEN));
            }
            MESSAGE_LOG.set(guildId, []);
        }
    }, {
        timezone: 'Asia/Tokyo',
    });
}
