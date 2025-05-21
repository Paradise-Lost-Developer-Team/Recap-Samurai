import { ChatInputCommandInteraction, SlashCommandBuilder, ChannelType, MessageFlags } from 'discord.js';
import fs from 'fs';
import path from 'path';

export const data = new SlashCommandBuilder()
    .setName('setup')
    .setDescription('週次ダイジェストの送信チャンネルを設定します')
    .addChannelOption(option =>
        option.setName('channel')
            .setDescription('送信先チャンネル')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    const channel = interaction.options.getChannel('channel', true);

    // digest-config.jsonに保存
    const digestConfigPath = path.resolve(process.cwd(), 'data', 'digest-config.json');
    let digestConfig: Record<string, any> = {};
    if (fs.existsSync(digestConfigPath)) {
        digestConfig = JSON.parse(fs.readFileSync(digestConfigPath, 'utf-8'));
    }
    digestConfig.DIGEST_CHANNEL_ID = channel.id;
    fs.writeFileSync(digestConfigPath, JSON.stringify(digestConfig, null, 2), 'utf-8');

    await interaction.reply({ content: `週次ダイジェストの送信チャンネルを <#${channel.id}> に設定しました！`, flags: MessageFlags.Ephemeral });
}
