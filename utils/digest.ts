// 要約侍 - digest.ts
    // 機能: 週次ダイジェスト & キーワードアラート + 永続化

    import { ExtendedClient } from '../index';
    import fs from 'fs';
    import path from 'path';
    import cron from 'node-cron';
    import { PredictionServiceClient } from '@google-cloud/aiplatform';
            
    const dataDir = path.resolve(process.cwd(), 'data');
    const configPath = path.join(dataDir, 'config.json');
        
    // config読み込み (Gemini設定)
    const { GEMINI_SERVICE_ACCOUNT_PATH, GEMINI_PROJECT_ID, GEMINI_LOCATION, GEMINI_MODEL_ID, ALTERNATE_GEMINI_MODEL_ID, ALTERNATE_MODEL_UNTIL } = JSON.parse(
        fs.readFileSync(configPath, 'utf-8')
    );
    // Vertex AI PaLMクライアント初期化 (keyFilenameは設定があれば使用)
    const clientOptions: any = {};
    if (GEMINI_SERVICE_ACCOUNT_PATH) {
      clientOptions.keyFilename = path.join(dataDir, GEMINI_SERVICE_ACCOUNT_PATH);
    }
    const aiClient = new PredictionServiceClient(clientOptions);

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

                // モデルIDを切り替え
                const useModel = (new Date() < new Date(ALTERNATE_MODEL_UNTIL)) ? ALTERNATE_GEMINI_MODEL_ID : GEMINI_MODEL_ID;
                const modelName = `projects/${GEMINI_PROJECT_ID}/locations/${GEMINI_LOCATION}/publishers/google/models/${useModel}`;
                const request: any = {
                    endpoint: modelName,
                    instances: [{ content: summaryText }],
                    parameters: { temperature: 0.2, maxOutputTokens: 300 },
                };
                const predictResArr = (await aiClient.predict(request)) as any[];
                const response = predictResArr[0];
                const digest = response.predictions?.[0]?.content ?? '要約に失敗しました';
                await channel.send(`📝 **要約侍による週次ダイジェスト**\n${digest}`);

                // メモリ上のログをクリア
                MESSAGE_LOG.set(guildId, []);
            }
        }, {
            timezone: 'Asia/Tokyo',
        });
    }
