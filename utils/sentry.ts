import * as Sentry from '@sentry/node';
import { httpIntegration, modulesIntegration } from '@sentry/node';
import { logError } from './errorLogger';
import * as fs from 'fs';
import * as path from 'path';

// 設定を読み込む関数
function loadConfig() {
  try {
    const configPath = path.resolve(__dirname, '../data/config.json');
    const configFile = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configFile);
  } catch (error) {
    console.error('config.jsonの読み込みに失敗しました:', error);
    return { sentry: { enabled: false } };
  }
}

/**
 * Sentryを初期化する
 */
export function initSentry(): void {
  const config = loadConfig();
  const sentryConfig = config.sentry || {};
  
  // Sentryが有効でなければ初期化しない
  if (!sentryConfig.enabled) {
    console.log('Sentry is disabled in config');
    return;
  }

  // 設定ファイルからDSNを使用、なければ環境変数を使用
  const dsn = sentryConfig.dsn || process.env.SENTRY_DSN;
  
  if (!dsn) {
    console.warn('Sentry DSNが設定されていません。Sentryは初期化されませんでした。');
    return;
  }

  Sentry.init({
    dsn: dsn,
    integrations: [
      httpIntegration(),
      modulesIntegration(),
    ],
    tracesSampleRate: sentryConfig.tracesSampleRate || 1.0,
    environment: sentryConfig.environment || process.env.NODE_ENV || 'development',
    // リリース情報を追加
    release: sentryConfig.release || process.env.npm_package_version || '0.0.0',
    // パフォーマンスモニタリングは tracesSampleRate で制御されます
  });
  
  console.log('Sentry initialized');
}

// 残りの実装は変更なし
export function captureException(error: Error | any, context?: string): void {
  if (context) {
    Sentry.withScope(scope => {
      scope.setTag('context', context);
      if (typeof error === 'string') {
        Sentry.captureMessage(error, 'error');
      } else {
        Sentry.captureException(error);
      }
    });
  } else {
    Sentry.captureException(error);
  }
  
  // 既存のエラーロガーも呼び出す
  logError(context || 'unknown', error instanceof Error ? error : new Error(String(error)));
}