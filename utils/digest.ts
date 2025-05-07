// 要約侍 - digest.ts
    // 機能: 週次ダイジェスト & キーワードアラート + 永続化

    import { ExtendedClient } from '../index';
    import fs from 'fs';
    import path from 'path';
    import cron from 'node-cron';
    import { GoogleGenAI, HarmCategory, SafetySetting } from '@google/genai';
            
    const dataDir = path.resolve(process.cwd(), 'data');
    const configPath = path.join(dataDir, 'config.json');
        
    // config読み込み (Gemini 設定)
    const { GEMINI_API_KEY, GEMINI_PROJECT_ID, GEMINI_LOCATION, GEMINI_MODEL_ID, ALTERNATE_GEMINI_MODEL_ID, ALTERNATE_MODEL_UNTIL } = JSON.parse(
        fs.readFileSync(configPath, 'utf-8')
    );
    // GoogleGenAI クライアント初期化
    const ai = new GoogleGenAI({
        vertexai: true,
        project: GEMINI_PROJECT_ID,
        location: GEMINI_LOCATION,
        apiKey: GEMINI_API_KEY,
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

        cron.schedule('0 0 0 * * 1', async () => {
            for (const [guildId, messages] of MESSAGE_LOG.entries()) {
                if (messages.length === 0) continue;

                const guild = await client.guilds.fetch(guildId);
                const channel =
                    guild.systemChannel ||
                    (await guild.channels.fetch()).find((c) => c?.isTextBased?.());
                if (!channel || !channel.isTextBased?.()) continue;

                const summaryText = messages.map((m) => `${m.author}: ${m.content}`).join('\n');
                // プロンプトと結合
                const promptInput = `${promptTemplate}\n\n${summaryText}`;
                // 生成設定
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
                // モデル選択
                const isAlternate = new Date() < new Date(ALTERNATE_MODEL_UNTIL);
                const model = isAlternate ? ALTERNATE_GEMINI_MODEL_ID : GEMINI_MODEL_ID;
                // ストリーミング生成
                let generated = '';
                const stream = await ai.models.generateContentStream({ model, contents: [promptInput], config: generationConfig });
                for await (const chunk of stream) {
                    if (chunk.text) generated += chunk.text;
                }
                const digest = generated || '要約に失敗しました';
                // 2000文字制限対応
                const MAX_LEN = 2000;
                const prefix = '📝 **要約侍による週次ダイジェスト**\n';
                for (let i = 0; i < digest.length; i += MAX_LEN) {
                    await channel.send(prefix + digest.slice(i, i + MAX_LEN));
                }

                // メモリ上のログをクリア
                MESSAGE_LOG.set(guildId, []);
            }
        }, {
            timezone: 'Asia/Tokyo',
        });
    }
