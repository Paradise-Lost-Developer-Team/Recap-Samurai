// digest-command.ts
// スラッシュコマンド: /digest - 手動で週次ダイジェストを出力

import { ChatInputCommandInteraction, SlashCommandBuilder, Message, TextChannel, Collection, MessageFlags, PermissionFlagsBits } from 'discord.js';
import type { FetchMessagesOptions } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { HarmCategory, SafetySetting } from '@google/genai';
import { MESSAGE_LOG } from '../../utils/digest';

const configPath = path.resolve(process.cwd(), 'data', 'config.json');
// config読み込み (Gemini設定)
const { GEMINI_SERVICE_ACCOUNT_PATH, GEMINI_PROJECT_ID, GEMINI_LOCATION, GEMINI_MODEL_ID, ALTERNATE_GEMINI_MODEL_ID, ALTERNATE_MODEL_UNTIL } = JSON.parse(
    fs.readFileSync(configPath, 'utf-8')
);
// GoogleGenAI クライアント初期化
const dataDir = path.resolve(process.cwd(), 'data');
const ai = new GoogleGenAI({
    vertexai: true,
    project: GEMINI_PROJECT_ID,
    location: GEMINI_LOCATION
});

// promptテンプレート読み込み
const promptTemplate = fs.readFileSync(path.resolve(process.cwd(), 'utils', 'prompt_digest.txt'), 'utf-8');

export const data = new SlashCommandBuilder()
    .setName('digest')
    .setDescription('今週のメッセージを要約して表示します');

export async function execute(interaction: ChatInputCommandInteraction) {
    try {
        // 初回応答を即時通知 (ephemeral)
        await interaction.reply({ content: '📝 要約を生成中です…少々お待ちください', flags: MessageFlags.Ephemeral });
        // メッセージログはメモリ上で管理 (永続化廃止)
        const guildId = interaction.guildId!;
        // in-memory ログ優先
        let messages: (string | Message)[] = (MESSAGE_LOG.get(guildId) as unknown as (string | Message)[]) || [];
        if (messages.length === 0) {
            // フォールバックで過去1週間のメッセージをDiscord APIから取得
            const channel = interaction.channel;
            if (!channel || !channel.isTextBased?.() || !('messages' in channel)) {
                await interaction.followUp({ content: 'このコマンドはテキストチャンネルでのみ使用可能です。', flags: MessageFlags.Ephemeral });
                return;
            }
            const textChannel = channel as TextChannel;
            // Botのチャンネル参照権限とメッセージ履歴閲覧権限をチェック
            const botMember = interaction.guild?.members.me;
            if (!botMember || !textChannel.permissionsFor(botMember).has(PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory)) {
                await interaction.followUp({ content: 'エラー: Botにこのチャンネルの参照とメッセージ履歴閲覧権限がありません。管理者に権限を付与してください。', flags: MessageFlags.Ephemeral });
                return;
            }
            const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
            let lastId: string | undefined;
            const allMessages: any[] = [];
            for (let i = 0; i < 10; i++) {
                const opts: FetchMessagesOptions = { limit: 100 };
                if (lastId) opts.before = lastId;
                const fetched = await (channel as TextChannel).messages.fetch(opts);
                if (fetched.size === 0) break;
                allMessages.push(...Array.from(fetched.values()));
                const last = fetched.last();
                if (!last || last.createdTimestamp <= oneWeekAgo) break;
                lastId = last.id;
            }
            messages = allMessages.filter(m => m.createdTimestamp > oneWeekAgo && !m.author.bot);
        }
        if (messages.length === 0) {
            await interaction.followUp({ content: '今週のメッセージログが見つかりませんでした。', flags: MessageFlags.Ephemeral });
            return;
        }
        const summaryText = messages
            .map(m => typeof m === 'string' ? m : `${m.author.tag}: ${m.content}`)
            .join('\n');

        // プロンプトテンプレートとメッセージを結合
        const promptInput = `${promptTemplate}\n
${summaryText}`;
        // GoogleGenAI でストリーミング要約生成
        const isAlternate = new Date() < new Date(ALTERNATE_MODEL_UNTIL);
        const model = isAlternate ? ALTERNATE_GEMINI_MODEL_ID : GEMINI_MODEL_ID;
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
        let generated = '';
        const streamingResp = await ai.models.generateContentStream({ model, contents: [promptInput], config: generationConfig });
        for await (const chunk of streamingResp) {
            if (chunk.text) generated += chunk.text;
        }
        const digest = generated || '要約に失敗しました';
        // 2000文字制限対応: チャンクに分割して送信
        const MAX_LEN = 2000;
        const prefix = '📝 **要約侍のダイジェスト結果**\n';
        const chunks: string[] = [];
        for (let i = 0; i < digest.length; i += MAX_LEN) {
            chunks.push(digest.slice(i, i + MAX_LEN));
        }
        // 最初のチャンクにヘッダを追加
        if (chunks.length > 0) {
            await interaction.followUp({ content: prefix + chunks[0] });
            for (let idx = 1; idx < chunks.length; idx++) {
                await interaction.followUp({ content: chunks[idx] });
            }
        } else {
            await interaction.followUp({ content: prefix + digest });
        }
    } catch (error: any) {
        console.error('digest command execution error:', error);
        // エラー時は followUp
        try {
            await interaction.followUp({ content: 'コマンド実行中にエラーが発生しました。', flags: MessageFlags.Ephemeral });
        } catch { /* suppress */ }
    }
}
