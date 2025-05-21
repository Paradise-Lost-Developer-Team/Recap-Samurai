import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { MESSAGE_LOG } from '../../utils/digest';

export const data = new SlashCommandBuilder()
    .setName('logsearch')
    .setDescription('メッセージログからキーワード全文検索')
    .addStringOption(option =>
        option.setName('query').setDescription('検索キーワード').setRequired(true)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    const query = interaction.options.getString('query', true);
    const guildId = interaction.guildId!;
    const messages = (MESSAGE_LOG.get(guildId) || []) as { content: string; author: string; timestamp: number }[];
    const results = messages.filter(m => m.content.includes(query));
    if (results.length === 0) {
        await interaction.reply({ content: '該当するメッセージはありません。', flags: MessageFlags.Ephemeral });
        return;
    }
    const lines = results.slice(-10).map(m => `${new Date(m.timestamp).toLocaleString()} ${m.author}: ${m.content}`);
    await interaction.reply({ content: `検索結果（最新10件）:\n` + lines.join('\n'), flags: MessageFlags.Ephemeral });
}
