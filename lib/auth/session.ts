import { jwtVerify, SignJWT } from 'jose';
import { cookies } from 'next/headers';
import { cookieConfig, logtoConfig } from './config';
import type { UserInfo, VirtualUser } from './types';

const LOGTO_SESSION_COOKIE = 'logto_session';
const VIRTUAL_USER_COOKIE = 'virtual_user';
const AUTH_ERROR_COOKIE = 'auth_error';

/**
 * 获取加密密钥
 */
function getSecretKey() {
  const secret = logtoConfig.cookieSecret;
  return new TextEncoder().encode(secret);
}

/**
 * 加密数据为 JWT
 */
async function encryptSession(data: Record<string, unknown>): Promise<string> {
  return new SignJWT(data)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSecretKey());
}

/**
 * 解密 JWT 数据
 */
async function decryptSession<T>(token: string): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload as T;
  } catch {
    return null;
  }
}

// ============================================
// Logto Session 管理
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

  cookieStore.set(LOGTO_SESSION_COOKIE, encrypted, {
    ...cookieConfig,
    maxAge: cookieConfig.maxAge,
  });
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

// ============================================
// 虚拟用户管理
// ============================================

/**
 * 设置虚拟用户
 */
export async function setVirtualUser(userInfo: UserInfo): Promise<void> {
  const cookieStore = await cookies();

  const virtualUserData = {
    isAuthenticated: true,
    isVirtual: true,
    userInfo: {
      iss: logtoConfig.endpoint || 'https://auth.upage.io',
      sub: userInfo.sub,
      aud: logtoConfig.appId || 'virtual-app',
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
      iat: Math.floor(Date.now() / 1000),
      name: userInfo.name || null,
      email: userInfo.email || null,
      phone_number: userInfo.phone_number || null,
      username: userInfo.username || null,
      picture: userInfo.picture || null,
    },
    lastVerified: Date.now(),
  };

  const encrypted = await encryptSession(virtualUserData);

  cookieStore.set(VIRTUAL_USER_COOKIE, encrypted, {
    ...cookieConfig,
    maxAge: cookieConfig.maxAge,
  });
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

  const data = await decryptSession<{
    isAuthenticated: boolean;
    isVirtual: boolean;
    userInfo: UserInfo;
    lastVerified: number;
  }>(virtualCookie.value);

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
    userInfo: data.userInfo,
  };
}

/**
 * 清除虚拟用户
 */
export async function clearVirtualUser(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(VIRTUAL_USER_COOKIE);
}

// ============================================
// 错误会话管理
// ============================================

/**
 * 设置认证错误
 */
export async function setAuthError(errorMessage: string): Promise<void> {
  const cookieStore = await cookies();
  const encrypted = await encryptSession({ errorMessage });

  cookieStore.set(AUTH_ERROR_COOKIE, encrypted, {
    ...cookieConfig,
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

  // 清除错误 cookie
  cookieStore.delete(AUTH_ERROR_COOKIE);

  return data?.errorMessage || null;
}
