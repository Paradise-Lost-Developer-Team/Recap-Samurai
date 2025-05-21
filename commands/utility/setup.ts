import { ChatInputCommandInteraction, SlashCommandBuilder, ChannelType } from 'discord.js';
import fs from 'fs';
import path from 'path';

const configPath = path.resolve(process.cwd(), 'data', 'config.json');

export const data = new SlashCommandBuilder()
    .setName('setup')
    .setDescription('週次ダイジェストの送信曜日・時刻・チャンネルを設定します')
    .addStringOption(option =>
        option.setName('weekday')
            .setDescription('送信する曜日 (例: monday, tuesday, ... sunday)')
            .setRequired(true)
            .addChoices(
                { name: '月曜', value: 'monday' },
                { name: '火曜', value: 'tuesday' },
                { name: '水曜', value: 'wednesday' },
                { name: '木曜', value: 'thursday' },
                { name: '金曜', value: 'friday' },
                { name: '土曜', value: 'saturday' },
                { name: '日曜', value: 'sunday' },
            )
    )
    .addStringOption(option =>
        option.setName('time')
            .setDescription('送信時刻 (24時間表記, 例: 07:00)')
            .setRequired(true)
    )
    .addChannelOption(option =>
        option.setName('channel')
            .setDescription('送信先チャンネル')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    const weekday = interaction.options.getString('weekday', true);
    const time = interaction.options.getString('time', true);
    const channel = interaction.options.getChannel('channel', true);

    // cron形式に変換
    const weekdayMap: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6
    };
    const [hour, minute] = time.split(':').map(Number);
    const cron = `${minute} ${hour} * * ${weekdayMap[weekday]}`;

    // digest-config.jsonに保存
    const digestConfigPath = path.resolve(process.cwd(), 'data', 'digest-config.json');
    let digestConfig: Record<string, any> = {};
    if (fs.existsSync(digestConfigPath)) {
        digestConfig = JSON.parse(fs.readFileSync(digestConfigPath, 'utf-8'));
    }
    digestConfig.DIGEST_CRON = cron;
    digestConfig.DIGEST_CHANNEL_ID = channel.id;
    fs.writeFileSync(digestConfigPath, JSON.stringify(digestConfig, null, 2), 'utf-8');

    await interaction.reply({ content: `週次ダイジェストの送信設定を更新しました！\n曜日: ${weekday} 時刻: ${time} チャンネル: <#${channel.id}>`, ephemeral: true });
}
