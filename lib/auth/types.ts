import type { IdTokenClaims } from '@logto/next';

/**
 * Logto 配置
 */
export interface LogtoConfig {
  endpoint: string;
  appId: string;
  appSecret: string;
  baseUrl: string;
  cookieSecret: string;
  scopes?: string[];
}

/**
 * 用户信息类型
 */
export interface UserInfo extends IdTokenClaims {
  name?: string | null;
  email?: string | null;
  picture?: string | null;
  username?: string | null;
  phone_number?: string | null;
}

/**
 * 认证上下文
 */
export interface AuthContext {
  isAuthenticated: boolean;
  userInfo?: UserInfo;
  claims?: IdTokenClaims;
}

/**
 * Mock 用户（开发环境）
 */
export interface MockUser extends AuthContext {
  isMock?: true;
}

/**
 * 虚拟用户（通过管理后台登录）
 */
export interface VirtualUser extends AuthContext {
  isVirtual: true;
}

/**
 * Logto 用户（从数据库）
 */
export interface LogtoUser {
  id: string;
  name?: string | null;
  username?: string | null;
  primaryEmail?: string | null;
  primaryPhone?: string | null;
  avatar?: string | null;
}

/**
 * requireAuth 选项
 */
export interface RequireAuthOptions {
  isApi?: boolean;
  redirectTo?: string;
}
