    // 要約侍 - digest.ts
    // 機能: 週次ダイジェスト & キーワードアラート

import { ExtendedClient } from '../index';
import OpenAI from 'openai';
import cron from 'node-cron';

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const KEYWORDS = ['緊急', 'トラブル', '質問'];
    export const MESSAGE_LOG = new Map<string, { content: string; author: string; timestamp: number }[]>();

export function setupDigestBot(client: ExtendedClient) {
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;

        const log = MESSAGE_LOG.get(message.guildId!) || [];
        log.push({
        content: message.content,
        author: message.author.tag,
        timestamp: message.createdTimestamp,
        });
        MESSAGE_LOG.set(message.guildId!, log);

        if (KEYWORDS.some((kw) => message.content.includes(kw))) {
        await message.reply(`⚠️ キーワード「${KEYWORDS.find((kw) => message.content.includes(kw))}」が検出されました。`);
        }
    });

    cron.schedule('0 0 0 * * 1', async () => {
        for (const [guildId, messages] of MESSAGE_LOG.entries()) {
        const guild = await client.guilds.fetch(guildId);
        const channel = guild.systemChannel || (await guild.channels.fetch()).find((c) => c?.isTextBased?.());
        if (!channel || !channel?.isTextBased?.()) continue;

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
        MESSAGE_LOG.set(guildId, []);
        }
    }, {
        timezone: 'Asia/Tokyo',
    });
}
