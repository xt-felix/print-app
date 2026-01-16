import type { LogtoConfig } from './types';

/**
 * Logto 配置
 */
export const logtoConfig: LogtoConfig = {
  endpoint: process.env.LOGTO_ENDPOINT || '',
  appId: process.env.LOGTO_APP_ID || '',
  appSecret: process.env.LOGTO_APP_SECRET || '',
  baseUrl: process.env.LOGTO_BASE_URL || 'http://localhost:3000',
  cookieSecret: process.env.LOGTO_COOKIE_SECRET || 's3cr3t-default-key-change-me',
  scopes: ['email', 'profile'],
};

/**
 * Cookie 配置
 */
export const cookieConfig = {
  httpOnly: true,
  path: '/',
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 60 * 60 * 24 * 30, // 30 天
};

/**
 * 认证路由配置
 */
export const authRoutes = {
  signIn: '/api/auth/sign-in',
  signOut: '/api/auth/sign-out',
  callback: '/api/auth/callback',
  home: '/',
};

/**
 * 是否启用认证
 */
export function shouldEnforceAuth(): boolean {
  return process.env.LOGTO_ENABLE === 'true';
}
