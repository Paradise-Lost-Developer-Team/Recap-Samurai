// ─ subscription.ts ────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { client } from '../index';
import { logError } from './errorLogger';

// プロジェクトルートディレクトリを取得
function getProjectRoot(): string {
    const currentDir = __dirname;
    if (currentDir.includes('build/js/utils') || currentDir.includes('build\\js\\utils')) {
        return path.resolve(path.join(currentDir, '..', '..', '..'));
    } else if (currentDir.includes('/utils') || currentDir.includes('\\utils')) {
        return path.resolve(path.join(currentDir, '..'));
    } else {
        return process.cwd();
    }
}

export enum SubscriptionType {
    TRIAL   = 'trial',
    BASIC   = 'basic',
    PREMIUM = 'premium'
}

// サブスクリプション情報の型
interface SubscriptionData {
    [guildId: string]: {
        type: SubscriptionType;
        expiresAt: number; // UTCタイムスタンプ
    };
}

const SUBSCRIPTION_FILE_PATH = path.join(__dirname, '..', 'data', 'subscriptions.json');

// サブスクリプションデータのロード
export function loadSubscriptions(): SubscriptionData {
    try {
        // data ディレクトリが存在しない場合は作成
        const dataDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        // ファイルが存在しない場合は空のJSONを作成
        if (!fs.existsSync(SUBSCRIPTION_FILE_PATH)) {
            fs.writeFileSync(SUBSCRIPTION_FILE_PATH, JSON.stringify({}, null, 2));
            return {};
        }
        
        const data = fs.readFileSync(SUBSCRIPTION_FILE_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('サブスクリプションデータ読み込みエラー:', error);
        logError('subscriptionLoadError', error instanceof Error ? error : new Error(String(error)));
        return {};
    }
}

// サブスクリプションデータの保存
export function saveSubscriptions(data: SubscriptionData): void {
    try {
        fs.writeFileSync(SUBSCRIPTION_FILE_PATH, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('サブスクリプションデータ保存エラー:', error);
        logError('subscriptionSaveError', error instanceof Error ? error : new Error(String(error)));
    }
}

// サブスクリプションの取得
export function getSubscription(guildId: string): SubscriptionType {
    const subscriptions = loadSubscriptions();
    const guildSubscription = subscriptions[guildId];
    
    // サブスクリプションがない、または期限切れの場合
    if (!guildSubscription || guildSubscription.expiresAt < Date.now()) {
        return SubscriptionType.TRIAL; // デフォルトはトライアル
    }
    
    return guildSubscription.type;
}

// サブスクリプションの設定
export function setSubscription(guildId: string, type: SubscriptionType, durationDays: number): void {
    const subscriptions = loadSubscriptions();
    
    subscriptions[guildId] = {
        type,
        expiresAt: Date.now() + (durationDays * 24 * 60 * 60 * 1000)
    };
    
    saveSubscriptions(subscriptions);
}

// BOT作者のユーザーID
const BOT_OWNER_ID = '809627147333140531';

// サブスクリプションデータファイルパス
const PROJECT_ROOT = getProjectRoot();
const SUBSCRIPTION_FILE = path.join(PROJECT_ROOT, 'subscriptions.json');

// サブスクリプション情報の型定義
export interface Subscription {
    isPremium: any;
    userId: string;          // Discord User ID
    guildIds: string[];      // 適用するサーバーID一覧
    startDate: string;       // 開始日 (ISO文字列)
    endDate: string;         // 終了日 (ISO文字列)
    tier: SubscriptionType;  // サブスクリプションのティア
    active: boolean;         // 有効状態
}

// サブスクリプションデータの型定義
interface SubscriptionsData {
    [userId: string]: Subscription;
}

// サブスクリプションデータを読み込む
function loadSubscriptionsOld(): SubscriptionsData {
    try {
        if (fs.existsSync(SUBSCRIPTION_FILE)) {
            const data = fs.readFileSync(SUBSCRIPTION_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('サブスクリプションデータ読み込みエラー:', error);
    }
    return {};
}

// サブスクリプションデータを保存する
function saveSubscriptionsOld(subscriptions: SubscriptionsData): void {
    try {
        // ディレクトリ確認
        const dir = path.dirname(SUBSCRIPTION_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(SUBSCRIPTION_FILE, JSON.stringify(subscriptions, null, 2), 'utf8');
    } catch (error) {
        console.error('サブスクリプションデータ保存エラー:', error);
    }
}

// 全てのサブスクリプションデータ
const subscriptions = loadSubscriptionsOld();

// ユーザーのサブスクリプション情報を取得する
export function getUserSubscription(userId: string): Subscription | null {
    const subscription = subscriptions[userId];
    
    if (!subscription) {
        return null;
    }
    
    // 有効期限切れの確認
    if (subscription.active && new Date(subscription.endDate) < new Date()) {
        subscription.active = false;
        saveSubscriptionsOld(subscriptions);
    }
    
    return subscription;
}

// ギルドのサブスクリプション情報を取得する
export function getGuildSubscriptionTier(guildId: string): SubscriptionType {
    // Bot製作者が管理するサーバーかどうかを確認
    if (isOwnerGuild(guildId)) {
        console.log(`Bot製作者が管理するサーバー ${guildId} にPremium特権を付与`);
        return SubscriptionType.PREMIUM;
    }
    // 該当するサブスクリプションがなければTRIAL
    return SubscriptionType.TRIAL;
}

// 新しいサブスクリプションを追加する
export function addSubscription(subscription: Subscription): void {
    subscriptions[subscription.userId] = subscription;
    saveSubscriptionsOld(subscriptions);
}

// サブスクリプションを更新する
export function updateSubscription(userId: string, updates: Partial<Subscription>): boolean {
    if (!subscriptions[userId]) {
        return false;
    }
    
    subscriptions[userId] = {
        ...subscriptions[userId],
        ...updates
    };
    
    saveSubscriptionsOld(subscriptions);
    return true;
}

// サブスクリプションをキャンセルする
export function cancelSubscription(userId: string): boolean {
    if (!subscriptions[userId]) {
        return false;
    }
    
    subscriptions[userId].active = false;
    saveSubscriptionsOld(subscriptions);
    return true;
}

// Basic版機能が利用可能かチェック
export function isProFeatureAvailable(guildId: string, p0: string): boolean {
    const tier = getGuildSubscriptionTier(guildId);
    return tier === SubscriptionType.BASIC || tier === SubscriptionType.PREMIUM;
}

// Premium版機能が利用可能かチェック
export function isPremiumFeatureAvailable(guildId: string, p0: string): boolean {
    // 作者が管理するサーバーの場合は常にtrue
    if (isOwnerGuild(guildId)) {
        return true;
    }

    const tier = getGuildSubscriptionTier(guildId);
    return tier === SubscriptionType.PREMIUM;
}

// 指定したギルドがBOT作者の管理下にあるかどうかを確認する
function isOwnerGuild(guildId: string): boolean {
    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return false;
        
        // 既存の ownerId を利用する（guild.ownerId は string 型であるための変更）
        const ownerId = guild.ownerId;
        if (ownerId === BOT_OWNER_ID) {
            return true;
        }
        
        // BOT作者が管理者権限を持っているかチェック
        const ownerMember = guild.members.cache.get(BOT_OWNER_ID);
        if (ownerMember && ownerMember.permissions.has('Administrator')) {
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('オーナーギルドチェックエラー:', error);
        return false;
    }
}
