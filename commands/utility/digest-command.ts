// digest-command.ts
// スラッシュコマンド: /digest - 手動で週次ダイジェストを出力

import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

const configPath = path.resolve(process.cwd(), 'data', 'config.json');
const { OPENAI_API_KEY } = JSON.parse(
    fs.readFileSync(configPath, 'utf-8')
);

const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

// メッセージログは外部からインポートされると仮定
import { MESSAGE_LOG } from '../../utils/digest';

export const data = new SlashCommandBuilder()
    .setName('digest')
    .setDescription('今週のメッセージを要約して表示します');

export async function execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId;
    const messages = MESSAGE_LOG.get(guildId!);

    if (!messages || messages.length === 0) {
        await interaction.reply('今週のメッセージログが見つかりませんでした。');
        return;
    }

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
    await interaction.reply(`📝 **要約侍のダイジェスト結果**\n${completion.choices[0].message.content}`);
}
