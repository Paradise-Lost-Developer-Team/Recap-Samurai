import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.join(__dirname, '../logs');

/**
 * エラーをログファイルに記録する
 * @param type エラータイプ
 * @param error エラーオブジェクト
 */
export function logError(type: string, error: Error): void {
    try {
        // ログディレクトリが存在しない場合は作成
        if (!fs.existsSync(LOG_DIR)) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
        }

        const now = new Date();
        const timestamp = now.toISOString().replace(/:/g, '-');
        const dateStr = now.toISOString().split('T')[0];
        
        // 日付ごとのログファイル
        const logFile = path.join(LOG_DIR, `error-${dateStr}.log`);
        
        // エラーメッセージの構築
        const errorMessage = `[${timestamp}] [${type}] ${error.message}\n${error.stack || 'No stack trace'}\n\n`;
        
        // ログファイルに追記
        fs.appendFileSync(logFile, errorMessage);
        
        // 重大なエラーの場合は個別ファイルにも出力
        if (type.includes('uncaught') || type.includes('unhandled') || type === 'botStartupError') {
            const criticalLogFile = path.join(LOG_DIR, `critical-${timestamp}.log`);
            fs.writeFileSync(criticalLogFile, errorMessage);
        }
    } catch (logError) {
        // ログ記録自体が失敗した場合はコンソールに出力するのみ
        console.error('ログの記録に失敗しました:', logError);
        console.error('元のエラー:', error);
    }
}

/**
 * 古いログファイルをクリーンアップする (30日以上経過したもの)
 */
export function cleanupOldLogs(): void {
    try {
        if (!fs.existsSync(LOG_DIR)) return;
        
        const files = fs.readdirSync(LOG_DIR);
        const now = Date.now();
        const MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30日
        
        files.forEach(file => {
            const filePath = path.join(LOG_DIR, file);
            const stat = fs.statSync(filePath);
            const fileAge = now - stat.mtime.getTime();
            
            if (fileAge > MAX_AGE) {
                fs.unlinkSync(filePath);
                console.log(`古いログファイルを削除しました: ${file}`);
            }
        });
    } catch (error) {
        console.error('ログクリーンアップエラー:', error);
    }
}

// 起動時に古いログをクリーンアップ
cleanupOldLogs();

// 毎日午前0時にログクリーンアップを実行
const scheduleNextCleanup = () => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const timeUntilMidnight = tomorrow.getTime() - now.getTime();
    setTimeout(() => {
        cleanupOldLogs();
        scheduleNextCleanup(); // 次の日のためにスケジュール
    }, timeUntilMidnight);
};

scheduleNextCleanup();
