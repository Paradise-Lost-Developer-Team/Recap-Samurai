// 要約侍 - digest.ts
// 機能: 週次ダイジェスト & キーワードアラート

import { ExtendedClient } from '../index';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { GoogleGenAI, HarmCategory, SafetySetting } from '@google/genai';
import jsPDF from 'jspdf';
import Papa from 'papaparse';
        
const dataDir = path.resolve(process.cwd(), 'data');
const configPath = path.join(dataDir, 'config.json');
const LOGS_DIR = path.resolve(process.cwd(), 'data', 'logs');
    
// config読み込み (Gemini 設定)
const { GEMINI_API_KEY, GEMINI_MODEL_ID, ALTERNATE_GEMINI_MODEL_ID } = JSON.parse(
    fs.readFileSync(configPath, 'utf-8')
);
// GoogleGenAI クライアント初期化
const ai = new GoogleGenAI({
    apiKey: GEMINI_API_KEY
});
// prompt テンプレート読み込み
const promptTemplate = fs.readFileSync(path.resolve(process.cwd(), 'utils', 'prompt_digest.txt'), 'utf-8');

const KEYWORDS = ['緊急', 'トラブル', '質問'];
export const MESSAGE_LOG = new Map<string, { content: string; author: string; timestamp: number }[]>();

let globalDigestClient: ExtendedClient | null = null;

if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function saveGuildLog(guildId: string) {
    const log = MESSAGE_LOG.get(guildId) || [];
    fs.writeFileSync(path.join(LOGS_DIR, `${guildId}.json`), JSON.stringify(log, null, 2), 'utf-8');
}

function loadGuildLog(guildId: string) {
    const file = path.join(LOGS_DIR, `${guildId}.json`);
    if (fs.existsSync(file)) {
        try {
            const arr = JSON.parse(fs.readFileSync(file, 'utf-8'));
            if (Array.isArray(arr)) MESSAGE_LOG.set(guildId, arr);
        } catch {}
    }
}

export function setupDigestBot(client: ExtendedClient) {
    globalDigestClient = client;

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
        saveGuildLog(guildId);

        if (KEYWORDS.some((kw) => message.content.includes(kw))) {
            const hit = KEYWORDS.find((kw) => message.content.includes(kw));
            await message.reply(`⚠️ キーワード「${hit}」が検出されました。`);
        }
    });

    // Bot起動時に全ギルドのログを復元
    client.on('ready', async () => {
        for (const guild of client.guilds.cache.values()) {
            loadGuildLog(guild.id);
        }
    });

    // configからcron式とチャンネルIDを取得
    let digestCron: string = '0 0 7 * * 1';
    let digestChannelId: string | null = null;
    let ALTERNATE_MODEL_UNTIL: string | null = null;
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.DIGEST_CRON) digestCron = config.DIGEST_CRON;
        if (config.DIGEST_CHANNEL_ID) digestChannelId = config.DIGEST_CHANNEL_ID;
        if (config.ALTERNATE_MODEL_UNTIL) ALTERNATE_MODEL_UNTIL = config.ALTERNATE_MODEL_UNTIL;
    } catch {}

    cron.schedule(digestCron, async () => {
        for (const [guildId, messages] of MESSAGE_LOG.entries()) {
            if (messages.length === 0) continue;
            const guild = await client.guilds.fetch(guildId);
            let channel = null;
            if (digestChannelId) {
                try {
                    channel = await guild.channels.fetch(digestChannelId);
                } catch {}
            }
            if (!channel || !channel.isTextBased?.()) {
                channel = guild.systemChannel || (await guild.channels.fetch()).find((c) => c?.isTextBased?.());
            }
            if (!channel || !channel.isTextBased?.()) continue;

            // --- 発言量ランキング・反応率ランキング集計 ---
            const userMessageCount: Record<string, number> = {};
            const userReactionCount: Record<string, number> = {};
            for (const m of messages) {
                // mは{ content, author, timestamp }型
                const author = typeof m === 'string' ? 'unknown' : m.author;
                userMessageCount[author] = (userMessageCount[author] || 0) + 1;
                // 反応数はメッセージオブジェクトにreactionsがあればカウント（なければ0）
                // 今回はメモリログにはreactions情報がないため0固定
                userReactionCount[author] = userReactionCount[author] || 0;
            }
            // 発言数ランキング（上位5）
            const messageRanking = Object.entries(userMessageCount)
                .sort((a, b) => Number(b[1]) - Number(a[1]))
                .slice(0, 5)
                .map(([user, count], i) => `${i + 1}. ${user}：${count}件`)
                .join('\n');
            // 反応率ランキング（上位5）
            const reactionRanking = Object.entries(userReactionCount)
                .map(([user, reaction]) => {
                    const msg = userMessageCount[user] || 1;
                    return [user, Number(reaction) / msg];
                })
                .sort((a, b) => Number(b[1]) - Number(a[1]))
                .slice(0, 5)
                .map(([user, rate], i) => `${i + 1}. ${user}：${(rate as number).toFixed(2)}件/発言`)
                .join('\n');
            // --- MVPメンバー集計 ---
            // 今月のメッセージのみ抽出
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);
            const monthlyMessageCount: Record<string, number> = {};
            for (const m of messages) {
                if (typeof m === 'string') continue;
                if (m.timestamp >= startOfMonth.getTime()) {
                    const author = m.author;
                    monthlyMessageCount[author] = (monthlyMessageCount[author] || 0) + 1;
                }
            }
            let mvpText = '該当者なし';
            if (Object.keys(monthlyMessageCount).length > 0) {
                const mvp = Object.entries(monthlyMessageCount).sort((a, b) => b[1] - a[1])[0];
                mvpText = `${mvp[0]}（${mvp[1]}件）`;
            }
            // --- ダイジェスト本文生成 ---
            const summaryText = messages.map((m) => `${m.author}: ${m.content}`).join('\n');
            const promptInput = `${promptTemplate}\n\n${summaryText}`;
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
            let isAlternate = false;
            if (ALTERNATE_MODEL_UNTIL) {
                isAlternate = new Date() < new Date(ALTERNATE_MODEL_UNTIL);
            }
            const model = isAlternate ? ALTERNATE_GEMINI_MODEL_ID : GEMINI_MODEL_ID;
            let generated = '';
            const stream = await ai.models.generateContentStream({ model, contents: [promptInput], config: generationConfig });
            for await (const chunk of stream) {
                if (chunk.text) generated += chunk.text;
            }
            const digest = generated || '要約に失敗しました';
            const MAX_LEN = 2000;
            const prefix =
                '📝 **要約侍による週次ダイジェスト**\n' +
                '---\n' +
                `🏆【今月のMVPメンバー】\n${mvpText}\n` +
                '---\n' +
                '【発言量ランキングTOP5】\n' +
                (messageRanking || 'データなし') +
                '\n\n【リアクション率ランキングTOP5】\n' +
                (reactionRanking || 'データなし') +
                '\n---\n';
            for (let i = 0; i < digest.length; i += MAX_LEN) {
                await channel.send(prefix + digest.slice(i, i + MAX_LEN));
            }
            MESSAGE_LOG.set(guildId, []);
        }
    }, {
        timezone: 'Asia/Tokyo',
    });

    // --- 追加: 24h/週次/月次A4要約 ---
    // 24hごと
    cron.schedule('0 0 * * *', async () => {
        await generateA4Summary('24h', client);
    }, { timezone: 'Asia/Tokyo' });
    // 週次（日曜23:50）
    cron.schedule('50 23 * * 0', async () => {
        await generateA4Summary('week', client);
    }, { timezone: 'Asia/Tokyo' });
    // 月次（月末23:55）
    cron.schedule('55 23 28-31 * *', async () => {
        const now = new Date();
        const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        if (now.getDate() === last.getDate()) {
            await generateA4Summary('month', client);
        }
    }, { timezone: 'Asia/Tokyo' });

    async function generateA4Summary(period: '24h' | 'week' | 'month', client: ExtendedClient) {
        for (const [guildId, messages] of MESSAGE_LOG.entries()) {
            if (messages.length === 0) continue;
            const guild = await client.guilds.fetch(guildId);
            let channel = null;
            if (digestChannelId) {
                try {
                    channel = await guild.channels.fetch(digestChannelId);
                } catch {}
            }
            if (!channel || !channel.isTextBased?.()) {
                channel = guild.systemChannel || (await guild.channels.fetch()).find((c) => c?.isTextBased?.());
            }
            if (!channel || !channel.isTextBased?.()) continue;

            // 期間ごとにメッセージ抽出
            let since = 0;
            const now = Date.now();
            if (period === '24h') since = now - 24 * 60 * 60 * 1000;
            if (period === 'week') since = now - 7 * 24 * 60 * 60 * 1000;
            if (period === 'month') {
                const d = new Date();
                d.setDate(1); d.setHours(0, 0, 0, 0);
                since = d.getTime();
            }
            const periodMessages = messages.filter(m => typeof m !== 'string' && m.timestamp >= since);
            if (periodMessages.length === 0) continue;
            // A4要約プロンプト
            const a4Prompt =
                'あなたは優秀な議事録AIです。以下のDiscordメッセージから「重要トピックだけをA4 1枚分（1800字以内）」で日本語で要約してください。' +
                '\n- 重要な話題・決定事項・議論の流れを簡潔にまとめること\n- 些細な雑談やノイズは省略すること\n- 箇条書きやセクション分けで構造化すること\n- 可能な限り原文引用（「」）を使い、要点を明確にすること\n- 期間: ' +
                (period === '24h' ? '直近24時間' : period === 'week' ? '今週' : '今月') + '\n\nメッセージ:\n';
            const summaryText = periodMessages.map(m => `${m.author}: ${m.content}`).join('\n');
            const promptInput = `${a4Prompt}\n${summaryText}`;
            const generationConfig = {
                maxOutputTokens: 2048,
                temperature: 0.7,
                topP: 0.95,
                responseModalities: ['TEXT'],
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: 'OFF' },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: 'OFF' },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: 'OFF' },
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: 'OFF' },
                ] as SafetySetting[],
            };
            let isAlternate = false;
            if (ALTERNATE_MODEL_UNTIL) {
                isAlternate = new Date() < new Date(ALTERNATE_MODEL_UNTIL);
            }
            const model = isAlternate ? ALTERNATE_GEMINI_MODEL_ID : GEMINI_MODEL_ID;
            let generated = '';
            const stream = await ai.models.generateContentStream({ model, contents: [promptInput], config: generationConfig });
            for await (const chunk of stream) {
                if (chunk.text) generated += chunk.text;
            }
            const digest = generated || 'A4要約に失敗しました';
            const MAX_LEN = 2000;
            const prefix =
                `📄 **${period === '24h' ? '24時間' : period === 'week' ? '週次' : '月次'}A4重要トピック要約**\n---\n`;
            for (let i = 0; i < digest.length; i += MAX_LEN) {
                await channel.send(prefix + digest.slice(i, i + MAX_LEN));
            }
        }
    }

    // --- 有料ユーザー判定用 ---
    const patreonUsersPath = path.resolve(process.cwd(), 'data', 'patreon-users.json');
    function isPremiumUser(guildId: string): boolean {
        try {
            const patreon = JSON.parse(fs.readFileSync(patreonUsersPath, 'utf-8'));
            return !!patreon[guildId];
        } catch { return false; }
    }

    // --- メッセージログの長期アーカイブ管理 ---
    function archiveOldMessages() {
        const now = Date.now();
        for (const [guildId, messages] of MESSAGE_LOG.entries()) {
            if (isPremiumUser(guildId)) continue; // 有料は無制限
            // 無料は30日超過分を削除
            const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
            const filtered = messages.filter(m => typeof m !== 'string' && m.timestamp > now - THIRTY_DAYS);
            MESSAGE_LOG.set(guildId, filtered);
        }
    }
    // 1日1回アーカイブ実行
    cron.schedule('0 3 * * *', archiveOldMessages, { timezone: 'Asia/Tokyo' });

    // --- PDF/CSVレポート生成用 ---
    // --- 有料ユーザー向けカスタムレポート自動送信 ---
    cron.schedule('5 0 1 * *', async () => {
        for (const [guildId, messages] of MESSAGE_LOG.entries()) {
            if (!isPremiumUser(guildId)) continue;
            if (!messages.length) continue;
            if (!globalDigestClient) continue;
            const guild = await globalDigestClient.guilds.fetch(guildId);
            let channel = null;
            if (digestChannelId) {
                try { channel = await guild.channels.fetch(digestChannelId); } catch {}
            }
            if (!channel || !channel.isTextBased?.()) {
                channel = guild.systemChannel || (await guild.channels.fetch()).find((c: any) => c?.isTextBased?.());
            }
            if (!channel || !channel.isTextBased?.()) continue;
            // PDF生成
            const doc = new jsPDF();
            doc.setFontSize(12);
            doc.text('【カスタム月次レポート】', 10, 10);
            let y = 20;
            for (const m of messages) {
                if (y > 270) { doc.addPage(); y = 10; }
                doc.text(`${new Date(m.timestamp).toLocaleDateString()} ${m.author}: ${m.content}`, 10, y);
                y += 8;
            }
            const pdfBlob = doc.output('blob');
            // CSV生成
            const csv = Papa.unparse(messages.map(m => ({
                date: new Date(m.timestamp).toLocaleDateString(),
                author: m.author,
                content: m.content
            })));
            // Discord添付ファイルとして送信
            const { AttachmentBuilder } = await import('discord.js');
            const pdfBuffer = await pdfBlob.arrayBuffer();
            const pdfAttachment = new AttachmentBuilder(Buffer.from(pdfBuffer), { name: 'report.pdf' });
            const csvAttachment = new AttachmentBuilder(Buffer.from(csv, 'utf-8'), { name: 'report.csv' });
            await channel.send({ content: '【有料会員向けカスタム月次レポート】', files: [pdfAttachment, csvAttachment] });
        }
    }, { timezone: 'Asia/Tokyo' });
}
