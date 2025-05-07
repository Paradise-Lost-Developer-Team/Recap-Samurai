import { Client, GatewayIntentBits, ActivityType, MessageFlags, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { deployCommands } from "./utils/deploy-commands";
import { REST } from "@discordjs/rest";
import * as fs from "fs";
import * as path from "path";
import { logError } from "./utils/errorLogger";
import './utils/patreonIntegration'; // Patreon連携モジュールをインポート
import { initSentry } from './utils/sentry';
import { setupDigestBot } from './utils/digest';

// アプリケーション起動の最初にSentryを初期化
initSentry();

// 相対パス (プロジェクトルート) を使うよう変更
const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
    console.log(`データディレクトリを作成します: ${DATA_DIR}`);
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const CONFIG_PATH = path.resolve(process.cwd(), 'data', 'config.json');
const CONFIG = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const { TOKEN, GEMINI_SERVICE_ACCOUNT_PATH } = CONFIG;
// Google Application Default Credentials が読めるようにServiceAccountファイルパスを環境変数に設定
if (GEMINI_SERVICE_ACCOUNT_PATH) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(DATA_DIR, GEMINI_SERVICE_ACCOUNT_PATH);
}

export interface ExtendedClient extends Client {
    commands: Collection<string, any>;
}

export const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates] }) as ExtendedClient;
client.commands = new Collection(); // コマンド用の Collection を作成

// メッセージログ収集と週次ダイジェストのセットアップ
setupDigestBot(client);

const rest = new REST({ version: '9' }).setToken(TOKEN);

// 未処理の例外をハンドリング
process.on('uncaughtException', (error) => {
    console.error('未処理の例外が発生しました：', error);
    logError('uncaughtException', error);
    // クラッシュが深刻な場合は再起動させる（PM2が再起動を担当）
    if (error.message.includes('FATAL') || error.message.includes('CRITICAL')) {
        console.error('深刻なエラーのため、プロセスを終了します。');
        process.exit(1);
    }
});

// 未処理のPromiseリジェクトをハンドリング
process.on('unhandledRejection', (reason, promise) => {
    console.error('未処理のPromiseリジェクションが発生しました：', reason);
    logError('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
});

// グレースフルシャットダウン処理
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

async function gracefulShutdown() {
    console.log('シャットダウン中...');
    // voice connectionsはclient.destroy()で自動的に切断される
    
    // Discordクライアントからログアウト
    await client.destroy();
    console.log('正常にシャットダウンしました');
    process.exit(0);
}

client.once("ready", async () => {
    try {
        await deployCommands(client);
        console.log("コマンドのデプロイ完了");
        setInterval(async () => {
            try {
                const joinServerCount = client.guilds.cache.size;
                client.user!.setActivity(`サーバー数: ${joinServerCount}`, { type: ActivityType.Custom });
                await new Promise(resolve => setTimeout(resolve, 15000));
            } catch (error) {
                console.error("ステータス更新エラー:", error);
                logError('statusUpdateError', error instanceof Error ? error : new Error(String(error)));
            }
        }, 30000);
        console.log("起動完了");
    } catch (error) {
        console.error("Bot起動エラー:", error);
        logError('botStartupError', error instanceof Error ? error : new Error(String(error)));
    }
});

client.on("interactionCreate", async interaction => {
    try {
        // スラッシュコマンド処理
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;
            
            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(`コマンド実行エラー (${interaction.commandName}):`, error);
                
                // インタラクションの応答状態に基づいて適切に対応
                if (interaction.replied || interaction.deferred) {
                    try {
                        await interaction.followUp({ 
                            content: 'コマンド実行時にエラーが発生しました', 
                            flags: MessageFlags.Ephemeral 
                        });
                    } catch (e: any) {
                        if (e.code !== 10062) // Unknown interaction以外のエラーのみログ
                            console.error("FollowUp失敗:", e);
                    }
                } else {
                    try {
                        await interaction.reply({ 
                            content: 'コマンド実行時にエラーが発生しました', 
                            flags: MessageFlags.Ephemeral 
                        });
                    } catch (e: any) {
                        if (e.code !== 10062) // Unknown interaction以外のエラーのみログ
                            console.error("Reply失敗:", e);
                    }
                }
            }
        }
        
        // ボタンインタラクション処理
        else if (interaction.isButton()) {
            console.log(`ボタン押下: ${interaction.customId}`);
            
            // helpコマンドのボタン処理
            if (interaction.customId.startsWith('previous_') || interaction.customId.startsWith('next_')) {
                const helpCommand = require('./commands/utility/help');
                await helpCommand.buttonHandler(interaction);
            }
            // 他のボタンハンドラーはここに追加
        }
    } catch (error) {
        console.error('インタラクション処理エラー:', error);
    }
});

client.on("guildCreate", async (guild) => {
    try {
        const embed = new EmbedBuilder()
            .setTitle('Recap Samurai(要約侍)が導入されました！')
            .setDescription('ご導入ありがとうございます。このBotはコミュニティの会話を自動で要約・分析し、レポートをお届けします。')
            .addFields(
                { name: '主な機能', value: [
                        '• 定期要約ダイジェスト 24h/週次/月次で「重要トピックだけをA4 1枚分」に自動生成 ピン留めだけでなく、AIが選んだ“見逃せないメッセージ”も抽出',
                        '• キーワードアラート 管理者が指定した単語（例：トラブル、緊急、質問）を含む投稿があったら即通知',
                        '• 参加者インサイト 発言量ランキング・反応率（リアクションの付きやすさ）を可視化 「今月のMVPメンバー」を自動選出',
                        '• ログ検索&QAチャット 過去ログから、AIに自然言語で質問（「先月のイベントURLは？」など）',
                        '• 7日間無料トライアル 1週間、要約週次プランのみ無料。 トライアル後は“サーバー単位$5/月”スタート'
                    ].join('\n')
                },
                { name: 'プレミアム特典', value: [
                        '• リアルタイム要約/即時ダイジェスト（秒～分単位）',
                        '• 保存履歴の長期アーカイブ（無料:30日、有料:無制限）',
                        '• カスタムレポート自動送信（PDF/CSV）'
                    ].join('\n')
                },
                { name: 'プラン', value: [
                        '• トライアル（7日間）',
                        '• ベーシック',
                        '• プレミアム'
                    ].join('\n')
                }
            )
            .setColor(0x00CCFF)
            .setFooter({ text: 'Powered by Paradise-Lost-Server' });

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('利用規約')
                    .setStyle(ButtonStyle.Link)
                    .setURL('https://paradise-lost-developer-team.github.io/Aivis-chan-bot/Term-of-Service'),
                new ButtonBuilder()
                    .setLabel('プライバシーポリシー')
                    .setStyle(ButtonStyle.Link)
                    .setURL('https://paradise-lost-developer-team.github.io/Aivis-chan-bot/Privacy-Policy'),
                new ButtonBuilder()
                    .setLabel('PatreonでこのBotを使用可能にする')
                    .setStyle(ButtonStyle.Link)
                    .setURL('https://www.patreon.com/c/AlcJP02'),
                new ButtonBuilder()
                    .setLabel('サポートサーバー')
                    .setStyle(ButtonStyle.Link)
                    .setURL('https://discord.gg/c4TrxUD5XX')
            );

        const systemChannel = guild.systemChannel;
        if (systemChannel && systemChannel.isTextBased()) {
            await systemChannel.send({ embeds: [embed], components: [row] });
        }
    } catch (error) {
        console.error('Error sending welcome embed:', error);
    }
});

client.login(TOKEN).catch(error => {
    console.error("ログインエラー:", error);
    logError('loginError', error);
    process.exit(1);
});