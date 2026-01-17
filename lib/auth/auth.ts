import type { IdTokenClaims } from '@logto/next';
import LogtoClient from '@logto/next/server-actions';
import { jwtVerify, SignJWT } from 'jose';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import type {
  AuthContext,
  LogtoConfig,
  LogtoUser,
  MockUser,
  RequireAuthOptions,
  UserInfo,
  VirtualUser,
  VirtualUserSession,
} from './types';

// ============================================
// 配置
// ============================================

const CONFIG: LogtoConfig = {
  endpoint: process.env.LOGTO_ENDPOINT || '',
  appId: process.env.LOGTO_APP_ID || '',
  appSecret: process.env.LOGTO_APP_SECRET || '',
  baseUrl: process.env.LOGTO_BASE_URL || 'http://localhost:3000',
  cookieSecret: process.env.LOGTO_COOKIE_SECRET || 's3cr3t-default-key-change-me',
  scopes: ['email', 'profile'],
};

const COOKIE_CONFIG = {
  httpOnly: true,
  path: '/',
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 60 * 60 * 24 * 30, // 30 天
};

const AUTH_ROUTES = {
  signIn: '/api/auth/sign-in',
  signOut: '/api/auth/sign-out',
  callback: '/api/auth/callback',
  home: '/',
};

const LOGTO_SESSION_COOKIE = 'logto_session';
const VIRTUAL_USER_COOKIE = 'virtual_user';
const AUTH_ERROR_COOKIE = 'auth_error';

// ============================================
// Logto 客户端
// ============================================

export const logtoClient = new LogtoClient({
  endpoint: CONFIG.endpoint,
  appId: CONFIG.appId,
  appSecret: CONFIG.appSecret,
  baseUrl: CONFIG.baseUrl,
  cookieSecret: CONFIG.cookieSecret,
  cookieSecure: process.env.NODE_ENV === 'production',
  scopes: CONFIG.scopes,
});

// ============================================
// 工具函数
// ============================================

function getSecretKey() {
  return new TextEncoder().encode(CONFIG.cookieSecret);
}

async function encryptSession(data: Record<string, unknown>): Promise<string> {
  return new SignJWT(data)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSecretKey());
}

async function decryptSession<T>(token: string): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload as T;
  } catch {
    return null;
  }
}

/**
 * 检查是否启用认证
 */
export function shouldEnforceAuth(): boolean {
  return process.env.LOGTO_ENABLE === 'true';
}

// ============================================
// Mock 用户（开发环境）
// ============================================

function getMockDevUser(): MockUser {
  return {
    isAuthenticated: true,
    isMock: true,
    userInfo: {
      iss: 'https://mock.issuer.com',
      sub: 'mock-user-id',
      aud: 'mock-audience',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      name: 'Mock User',
      username: 'user',
      email: 'mock@example.com',
    } as IdTokenClaims,
  };
}

// ============================================
// Session 管理
// ============================================

/**
 * 设置 Logto 会话
 */
export async function setLogtoSession(data: {
  accessToken?: string;
  idToken?: string;
  userInfo?: UserInfo;
}): Promise<void> {
  const cookieStore = await cookies();
  const encrypted = await encryptSession({
    ...data,
    isAuthenticated: true,
  });

  cookieStore.set(LOGTO_SESSION_COOKIE, encrypted, COOKIE_CONFIG);
}

/**
 * 获取 Logto 会话
 */
export async function getLogtoSession(): Promise<{
  isAuthenticated: boolean;
  accessToken?: string;
  idToken?: string;
  userInfo?: UserInfo;
} | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(LOGTO_SESSION_COOKIE);

  if (!sessionCookie?.value) {
    return null;
  }

  return decryptSession(sessionCookie.value);
}

/**
 * 清除 Logto 会话
 */
export async function clearLogtoSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(LOGTO_SESSION_COOKIE);
}

/**
 * 设置虚拟用户
 */
export async function setVirtualUser(userInfo: LogtoUser): Promise<void> {
  const cookieStore = await cookies();

  const virtualUserData: VirtualUserSession = {
    isAuthenticated: true,
    isVirtual: true,
    userInfo: {
      iss: CONFIG.endpoint || 'https://auth.upage.io',
      sub: userInfo.id,
      aud: CONFIG.appId || 'virtual-app',
      exp: Math.floor(Date.now() / 1000) + COOKIE_CONFIG.maxAge,
      iat: Math.floor(Date.now() / 1000),
      name: userInfo.name,
      email: userInfo.primaryEmail,
      phone_number: userInfo.primaryPhone,
      username: userInfo.username,
      picture: userInfo.avatar,
    },
    lastVerified: Date.now(),
  };

  const encrypted = await encryptSession(virtualUserData as unknown as Record<string, unknown>);
  cookieStore.set(VIRTUAL_USER_COOKIE, encrypted, COOKIE_CONFIG);
}

/**
 * 获取虚拟用户
 */
export async function getVirtualUser(): Promise<VirtualUser | null> {
  const cookieStore = await cookies();
  const virtualCookie = cookieStore.get(VIRTUAL_USER_COOKIE);

  if (!virtualCookie?.value) {
    return null;
  }

  const data = await decryptSession<VirtualUserSession>(virtualCookie.value);

  if (!data || !data.isAuthenticated || !data.userInfo) {
    return null;
  }

  // 检查是否过期
  const now = Math.floor(Date.now() / 1000);
  if (data.userInfo.exp && data.userInfo.exp < now) {
    await clearVirtualUser();
    return null;
  }

  return {
    isAuthenticated: true,
    isVirtual: true,
    userInfo: data.userInfo as unknown as IdTokenClaims,
  };
}

/**
 * 清除虚拟用户
 */
export async function clearVirtualUser(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(VIRTUAL_USER_COOKIE);
}

/**
 * 设置认证错误
 */
export async function setAuthError(errorMessage: string): Promise<void> {
  const cookieStore = await cookies();
  const encrypted = await encryptSession({ errorMessage });

  cookieStore.set(AUTH_ERROR_COOKIE, encrypted, {
    ...COOKIE_CONFIG,
    maxAge: 60, // 1 分钟过期
  });
}

/**
 * 获取并清除认证错误
 */
export async function getAuthError(): Promise<string | null> {
  const cookieStore = await cookies();
  const errorCookie = cookieStore.get(AUTH_ERROR_COOKIE);

  if (!errorCookie?.value) {
    return null;
  }

  const data = await decryptSession<{ errorMessage: string }>(errorCookie.value);
  cookieStore.delete(AUTH_ERROR_COOKIE);

  return data?.errorMessage || null;
}

// ============================================
// 核心认证方法
// ============================================

/**
 * 获取当前用户信息
 * 优先级：
 * 1. 开发环境 Mock 用户 (LOGTO_ENABLE=false)
 * 2. 虚拟用户 (管理后台登录)
 * 3. Logto 认证用户
 */
export async function getUser(): Promise<AuthContext> {
  // 1. 开发环境返回 Mock 用户
  if (!shouldEnforceAuth()) {
    return getMockDevUser();
  }

  // 2. 检查虚拟用户
  const virtualUser = await getVirtualUser();
  if (virtualUser) {
    return virtualUser;
  }

  // 3. 检查 Logto 会话
  try {
    const context = await logtoClient.getLogtoContext({ fetchUserInfo: true });

    if (context.isAuthenticated && context.userInfo) {
      return {
        isAuthenticated: true,
        userInfo: context.userInfo,
        claims: context.claims,
      };
    }
  } catch (error) {
    console.error('[Auth] 获取 Logto 上下文失败:', error);
  }

  return { isAuthenticated: false };
}

/**
 * 检查用户是否已认证，未认证则重定向
 */
export async function requireUser(): Promise<AuthContext> {
  const context = await getUser();

  if (!context.isAuthenticated) {
    redirect(AUTH_ROUTES.signIn);
  }

  return context;
}

/**
 * 通用权限验证
 * API 路由返回 JSON 错误，页面路由重定向
 */
export async function requireAuth(options: RequireAuthOptions = {}): Promise<AuthContext | NextResponse> {
  const { isApi = false, redirectTo = AUTH_ROUTES.signIn } = options;

  const context = await getUser();

  if (!context.isAuthenticated) {
    if (isApi) {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: '请先登录',
          code: 401,
        },
        { status: 401 },
      );
    }

    redirect(redirectTo);
  }

  return context;
}

// ============================================
// 认证操作
// ============================================

/**
 * 登录
 */
export async function signIn(postRedirectUri?: string): Promise<Response> {
  try {
    const result = await logtoClient.handleSignIn({
      redirectUri: `${CONFIG.baseUrl}${AUTH_ROUTES.callback}`,
      postRedirectUri,
    });
    return Response.redirect(result.url);
  } catch (error) {
    console.error('[Auth] 登录失败:', error);
    await setAuthError('登录服务出现异常，请稍后再试');
    return Response.redirect(CONFIG.baseUrl);
  }
}

/**
 * 登出
 */
export async function signOut(): Promise<Response> {
  try {
    // 检查是否是虚拟用户
    const virtualUser = await getVirtualUser();
    if (virtualUser?.isVirtual) {
      console.info('[Auth] 虚拟用户退出登录');
      await clearVirtualUser();
      return Response.redirect(CONFIG.baseUrl);
    }

    // Logto 用户登出
    await clearLogtoSession();
    const signOutUrl = await logtoClient.handleSignOut(CONFIG.baseUrl);
    return Response.redirect(signOutUrl);
  } catch (error) {
    console.error('[Auth] 登出失败:', error);
    // 即使失败也清除本地会话
    await clearLogtoSession();
    await clearVirtualUser();
    return Response.redirect(CONFIG.baseUrl);
  }
}

/**
 * 处理 OAuth 回调
 */
export async function handleCallback(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const postRedirectUri = await logtoClient.handleSignInCallback(url.toString());

    // 获取用户信息并存储到会话
    const context = await logtoClient.getLogtoContext({ fetchUserInfo: true });

    if (context.isAuthenticated && context.userInfo) {
      await setLogtoSession({
        userInfo: context.userInfo as unknown as UserInfo,
      });
    }

    // 重定向到配置的 postRedirectUri 或首页
    const redirectTo = postRedirectUri || AUTH_ROUTES.home;
    return Response.redirect(`${CONFIG.baseUrl}${redirectTo}`);
  } catch (error) {
    console.error('[Auth] 回调处理失败:', error);

    let errorMessage = '登录失败，请稍后再试';

    if (error instanceof Error) {
      if (
        error.message.includes('fetch failed') ||
        error.message.includes('network') ||
        error.message.includes('ECONNREFUSED')
      ) {
        errorMessage = '无法连接到认证服务器，请检查网络连接';
      }
    }

    await setAuthError(errorMessage);
    return Response.redirect(CONFIG.baseUrl);
  }
}

// ============================================
// 导出配置（只读）
// ============================================

export const authConfig = {
  routes: AUTH_ROUTES,
  baseUrl: CONFIG.baseUrl,
} as const;
