// digest-command.ts
// スラッシュコマンド: /digest - 手動で週次ダイジェストを出力

import { ChatInputCommandInteraction, SlashCommandBuilder, Message, TextChannel, Collection, MessageFlags } from 'discord.js';
import type { FetchMessagesOptions } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { HarmCategory, SafetySetting } from '@google/genai';
import { MESSAGE_LOG } from '../../utils/digest';

const configPath = path.resolve(process.cwd(), 'data', 'config.json');
// config読み込み (Gemini設定)
const { GEMINI_SERVICE_ACCOUNT_PATH, GEMINI_PROJECT_ID, GEMINI_LOCATION, GEMINI_MODEL_ID, GEMINI_MODEL_VERSION, ALTERNATE_GEMINI_MODEL_ID, ALTERNATE_GEMINI_MODEL_VERSION, ALTERNATE_MODEL_UNTIL } = JSON.parse(
    fs.readFileSync(configPath, 'utf-8')
);
// GoogleGenAI クライアント初期化
const dataDir = path.resolve(process.cwd(), 'data');
const ai = new GoogleGenAI({ vertexai: true, project: GEMINI_PROJECT_ID, location: GEMINI_LOCATION });

export const data = new SlashCommandBuilder()
    .setName('digest')
    .setDescription('今週のメッセージを要約して表示します');

export async function execute(interaction: ChatInputCommandInteraction) {
    try {
        // 処理開始を即時通知 (ephemeral)
        await interaction.reply({ content: '📝 要約を生成中です…少々お待ちください', flags: MessageFlags.Ephemeral });
        const guildId = interaction.guildId!;
        // in-memory ログ優先
        let messages: (string | Message)[] = (MESSAGE_LOG.get(guildId) as unknown as (string | Message)[]) || [];
        if (messages.length === 0) {
            // フォールバックで過去1週間のメッセージをDiscord APIから取得
            const channel = interaction.channel;
            if (!channel || !channel.isTextBased?.() || !('messages' in channel)) {
                await interaction.editReply('このコマンドはテキストチャンネルでのみ使用可能です。');
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
            await interaction.editReply('今週のメッセージログが見つかりませんでした。');
            return;
        }
        const summaryText = messages
            .map(m => typeof m === 'string' ? m : `${m.author.tag}: ${m.content}`)
            .join('\n');

        // GoogleGenAI でストリーミング生成
        const generationConfig = {
            maxOutputTokens: 8192,
            temperature: 1,
            topP: 0.95,
            responseModalities: ['TEXT'],
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: 0 },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: 0 },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: 0 },
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: 0 },
            ] as unknown as SafetySetting[],
        };

        // モデル名を設定（例：GEMINI_MODEL_ID@GEMINI_MODEL_VERSION）
        const modelName = `${GEMINI_MODEL_ID}@${GEMINI_MODEL_VERSION}`;
        const req = { model: modelName, contents: [summaryText], config: generationConfig };
        let generated = '';
        for await (const chunk of await ai.models.generateContentStream(req)) {
            if (chunk.text) generated += chunk.text;
        }
        const digest = generated || '要約に失敗しました';
        await interaction.editReply(`📝 **要約侍のダイジェスト結果**\n${digest}`);
    } catch (error: any) {
        console.error('digest command execution error:', error);
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply('コマンド実行中にエラーが発生しました。');
            } else {
                await interaction.reply({ content: 'コマンド実行中にエラーが発生しました。', flags: MessageFlags.Ephemeral });
            }
        } catch (e) {
            console.error('Failed to send error message:', e);
        }
    }
}
