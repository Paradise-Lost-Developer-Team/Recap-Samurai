    // 要約侍 - digest.ts
    // 機能: 週次ダイジェスト & キーワードアラート + 永続化

    import { ExtendedClient } from '../index';
    import OpenAI from 'openai';
    import fs from 'fs';
    import path from 'path';
    import cron from 'node-cron';

    const dataDir = path.resolve(process.cwd(), 'data');
    const configPath = path.join(dataDir, 'config.json');
    const logPath = path.join(dataDir, 'message_logs.json');

    // config読み込み
    const { OPENAI_API_KEY } = JSON.parse(
        fs.readFileSync(configPath, 'utf-8')
    );

    // MESSAGE_LOG 永続化用読み書き
    function loadMessageLog(): void {
        if (!fs.existsSync(logPath)) return;
        try {
            const raw = fs.readFileSync(logPath, 'utf-8');
            const obj = JSON.parse(raw) as Record<string, {content:string;author:string;timestamp:number}[]>;
            for (const guildId of Object.keys(obj)) {
                MESSAGE_LOG.set(guildId, obj[guildId]);
            }
        } catch {
            // ignore parse errors
        }
    }

    function saveMessageLog(): void {
        const obj: Record<string, {content:string;author:string;timestamp:number}[]> = {};
        for (const [guildId, logs] of MESSAGE_LOG.entries()) {
            obj[guildId] = logs;
        }
        fs.writeFileSync(logPath, JSON.stringify(obj, null, 2), 'utf-8');
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const KEYWORDS = ['緊急', 'トラブル', '質問'];
    export const MESSAGE_LOG = new Map<string, { content: string; author: string; timestamp: number }[]>();

    export function setupDigestBot(client: ExtendedClient) {
        // 起動時にログを読み込む
        loadMessageLog();

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
            saveMessageLog();

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
                const completion = await openai.chat.completions.create({
                    model: 'gpt-3.5-turbo',
                    messages: [
                        {
                            role: 'system',
                            content: '次のDiscordメッセージの要点を日本語で簡潔にまとめてください（300文字以内）。',
                        },
                        {
                            role: 'user',
                            content: summaryText,
                        },
                    ],
                });

                await channel.send(`📝 **要約侍による週次ダイジェスト**\n${completion.choices[0].message.content}`);

                // ログをクリア＆保存
                MESSAGE_LOG.set(guildId, []);
                saveMessageLog();
            }
        }, {
            timezone: 'Asia/Tokyo',
        });
    }
