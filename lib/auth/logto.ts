import LogtoClient from '@logto/next/server-actions';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { authRoutes, logtoConfig, shouldEnforceAuth } from './config';
import { clearLogtoSession, clearVirtualUser, getVirtualUser, setAuthError, setLogtoSession } from './session';
import type { AuthContext, MockUser, RequireAuthOptions } from './types';

// ============================================
// Logto 客户端实例
// ============================================

export const logtoClient = new LogtoClient({
  endpoint: logtoConfig.endpoint,
  appId: logtoConfig.appId,
  appSecret: logtoConfig.appSecret,
  baseUrl: logtoConfig.baseUrl,
  cookieSecret: logtoConfig.cookieSecret,
  cookieSecure: process.env.NODE_ENV === 'production',
  scopes: logtoConfig.scopes,
});

// ============================================
// 开发环境 Mock 用户
// ============================================

/**
 * 获取开发环境 Mock 用户
 */
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
    },
  };
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
    redirect(authRoutes.signIn);
  }

  return context;
}

/**
 * 通用权限验证
 * API 路由返回 JSON 错误，页面路由重定向
 */
export async function requireAuth(options: RequireAuthOptions = {}): Promise<AuthContext | NextResponse> {
  const { isApi = false, redirectTo = authRoutes.signIn } = options;

  const context = await getUser();

  if (!context.isAuthenticated) {
    if (isApi) {
      // API 路由返回 JSON 错误
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: '请先登录',
          code: 401,
        },
        { status: 401 },
      );
    }

    // 页面路由重定向
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
      redirectUri: `${logtoConfig.baseUrl}${authRoutes.callback}`,
      postRedirectUri,
    });
    return Response.redirect(result.url);
  } catch (error) {
    console.error('[Auth] 登录失败:', error);
    await setAuthError('登录服务出现异常，请稍后再试');
    return Response.redirect(logtoConfig.baseUrl);
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
      return Response.redirect(logtoConfig.baseUrl);
    }

    // Logto 用户登出
    await clearLogtoSession();
    const signOutUrl = await logtoClient.handleSignOut(logtoConfig.baseUrl);
    return Response.redirect(signOutUrl);
  } catch (error) {
    console.error('[Auth] 登出失败:', error);
    // 即使失败也清除本地会话
    await clearLogtoSession();
    await clearVirtualUser();
    return Response.redirect(logtoConfig.baseUrl);
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
        userInfo: context.userInfo,
      });
    }

    // 重定向到配置的 postRedirectUri 或首页
    const redirectTo = postRedirectUri || authRoutes.home;
    return Response.redirect(`${logtoConfig.baseUrl}${redirectTo}`);
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
    return Response.redirect(logtoConfig.baseUrl);
  }
}
