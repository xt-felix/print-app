# Next.js Logto 认证实现指南

本文档详细说明 Next.js 项目中的 Logto 认证实现。

---

## 架构设计理念

### 简化的模块结构

```
lib/auth/
├── index.ts     # 统一导出
├── types.ts     # 类型定义
└── auth.ts      # 所有认证逻辑（配置、Session、核心方法）
```

**为什么采用这种简化结构？**

| 优点 | 说明 |
|------|------|
| **减少文件数量** | 从 5 个文件简化为 3 个，降低维护成本 |
| **避免循环依赖** | 类型单独放在 `types.ts`，逻辑集中在 `auth.ts` |
| **统一导入路径** | 通过 `index.ts` 统一导出，外部只需 `import from '@/lib/auth'` |

### 双运行时设计

Next.js 有两种运行时，我们的架构需要同时支持：

```
┌─────────────────────────────────────┐
│         Edge Runtime                │
│  • middleware.ts                    │
│  • 限制：不能用 Node.js API         │
│  • 优势：全球边缘节点，延迟低        │
│  • 用途：快速验证 JWT，拦截请求      │
└─────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│         Node.js Runtime             │
│  • API Routes                       │
│  • Server Components                │
│  • 能力：完整 Node.js API           │
│  • 用途：OAuth 流程，数据库操作      │
└─────────────────────────────────────┘
```

**为什么 middleware 只做 JWT 验证？**
- Edge Runtime 不支持 `cookies()` 的完整写入操作
- OAuth 回调需要设置 Cookie，必须在 Node.js Runtime
- 轻量验证放 Edge，复杂操作放 API Routes

### 三级用户优先级

```typescript
async function getUser(): Promise<AuthContext> {
  // 1️⃣ 开发环境 Mock 用户 (最高优先级)
  if (!shouldEnforceAuth()) {
    return getMockDevUser();
  }

  // 2️⃣ 虚拟用户 (管理后台登录)
  const virtualUser = await getVirtualUser();
  if (virtualUser) {
    return virtualUser;
  }

  // 3️⃣ Logto 真实用户
  const context = await logtoClient.getLogtoContext();
  // ...
}
```

| 级别 | 场景 | 用途 |
|------|------|------|
| Mock 用户 | `LOGTO_ENABLE=false` | 开发环境无需配置 Logto 即可运行 |
| 虚拟用户 | 管理后台代登录 | 客服/管理员模拟用户操作 |
| 真实用户 | 生产环境 | 正常的 OAuth 认证流程 |

---

## 目录结构

```
lib/
└── auth/
    ├── index.ts           # 统一导出
    ├── types.ts           # 类型定义
    └── auth.ts            # 配置 + Session + 核心认证逻辑

app/
├── api/
│   └── auth/
│       ├── sign-in/
│       │   └── route.ts   # 登录路由
│       ├── sign-out/
│       │   └── route.ts   # 登出路由
│       ├── callback/
│       │   └── route.ts   # OAuth 回调
│       └── user/
│           └── route.ts   # 获取用户信息

middleware.ts              # Next.js 中间件
```

---

## 1. 类型定义

### `lib/auth/types.ts`

```typescript
import type { IdTokenClaims } from '@logto/next';

// ============================================
// Logto 用户类型
// ============================================

export interface LogtoUserIdentity {
  userId: string;
  details: Record<string, unknown>;
}

export interface LogtoUserAddress {
  formatted?: string;
  streetAddress?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}

export interface LogtoUserProfile {
  familyName?: string;
  givenName?: string;
  middleName?: string;
  nickname?: string;
  preferredUsername?: string;
  profile?: string;
  website?: string;
  gender?: string;
  birthdate?: string;
  zoneinfo?: string;
  locale?: string;
  address?: LogtoUserAddress;
}

export interface LogtoSsoIdentity {
  tenantId: string;
  id: string;
  userId: string;
  issuer: string;
  identityId: string;
  detail: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  ssoConnectorId: string;
}

export interface LogtoUser {
  id: string;
  username: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  name: string | null;
  avatar: string | null;
  customData: Record<string, unknown>;
  identities: Record<string, LogtoUserIdentity>;
  lastSignInAt: number | null;
  createdAt: number;
  updatedAt: number;
  profile: LogtoUserProfile;
  applicationId: string | null;
  isSuspended: boolean;
  hasPassword?: boolean;
  ssoIdentities?: LogtoSsoIdentity[];
}

// ============================================
// 认证上下文类型
// ============================================

export interface AuthContext {
  isAuthenticated: boolean;
  isMock?: boolean;
  isVirtual?: boolean;
  userInfo?: IdTokenClaims;
  claims?: IdTokenClaims;
}

export interface MockUser extends AuthContext {
  isMock: true;
}

export interface VirtualUser extends AuthContext {
  isVirtual: true;
}

// ============================================
// 配置类型
// ============================================

export interface LogtoConfig {
  endpoint: string;
  appId: string;
  appSecret: string;
  baseUrl: string;
  cookieSecret: string;
  scopes: string[];
}

export interface RequireAuthOptions {
  isApi?: boolean;
  redirectTo?: string;
}

// ============================================
// Session 数据类型
// ============================================

export interface UserInfo {
  iss?: string;
  sub: string;
  aud?: string;
  exp?: number;
  iat?: number;
  name?: string | null;
  email?: string | null;
  phone_number?: string | null;
  username?: string | null;
  picture?: string | null;
}

export interface VirtualUserSession {
  isAuthenticated: boolean;
  isVirtual: boolean;
  userInfo: UserInfo;
  lastVerified: number;
}

export interface LogtoSession {
  isAuthenticated: boolean;
  accessToken?: string;
  idToken?: string;
  userInfo?: UserInfo;
}
```

---

## 2. 认证核心模块

### `lib/auth/auth.ts`

```typescript
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
  if (!sessionCookie?.value) return null;
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
  if (!virtualCookie?.value) return null;

  const data = await decryptSession<VirtualUserSession>(virtualCookie.value);
  if (!data || !data.isAuthenticated || !data.userInfo) return null;

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
  if (!errorCookie?.value) return null;

  const data = await decryptSession<{ errorMessage: string }>(errorCookie.value);
  cookieStore.delete(AUTH_ERROR_COOKIE);
  return data?.errorMessage || null;
}

// ============================================
// 核心认证方法
// ============================================

/**
 * 获取当前用户信息
 * 优先级：Mock 用户 > 虚拟用户 > Logto 用户
 */
export async function getUser(): Promise<AuthContext> {
  // 1. 开发环境返回 Mock 用户
  if (!shouldEnforceAuth()) {
    return getMockDevUser();
  }

  // 2. 检查虚拟用户
  const virtualUser = await getVirtualUser();
  if (virtualUser) return virtualUser;

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
        { error: 'Unauthorized', message: '请先登录', code: 401 },
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
    const virtualUser = await getVirtualUser();
    if (virtualUser?.isVirtual) {
      console.info('[Auth] 虚拟用户退出登录');
      await clearVirtualUser();
      return Response.redirect(CONFIG.baseUrl);
    }

    await clearLogtoSession();
    const signOutUrl = await logtoClient.handleSignOut(CONFIG.baseUrl);
    return Response.redirect(signOutUrl);
  } catch (error) {
    console.error('[Auth] 登出失败:', error);
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

    const context = await logtoClient.getLogtoContext({ fetchUserInfo: true });
    if (context.isAuthenticated && context.userInfo) {
      await setLogtoSession({
        userInfo: context.userInfo as unknown as UserInfo,
      });
    }

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
```

---

## 3. 导出入口

### `lib/auth/index.ts`

```typescript
// 认证方法导出
export {
  // 配置
  authConfig,
  clearLogtoSession,
  clearVirtualUser,
  getAuthError,
  getLogtoSession,
  // 核心方法
  getUser,
  getVirtualUser,
  handleCallback,
  // 客户端实例
  logtoClient,
  requireAuth,
  requireUser,
  setAuthError,
  // Session 管理
  setLogtoSession,
  setVirtualUser,
  shouldEnforceAuth,
  // 认证操作
  signIn,
  signOut,
} from './auth';

export type {
  AuthContext,
  LogtoConfig,
  LogtoSsoIdentity,
  LogtoUser,
  LogtoUserIdentity,
  LogtoUserProfile,
  MockUser,
  RequireAuthOptions,
  UserInfo,
  VirtualUser,
} from './types';
```

---

## 4. API 路由实现

### `app/api/auth/sign-in/route.ts`

```typescript
import { NextRequest } from 'next/server';
import { shouldEnforceAuth, signIn } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // 开发环境跳过登录
  if (!shouldEnforceAuth()) {
    const baseUrl = process.env.LOGTO_BASE_URL || 'http://localhost:3000';
    return Response.redirect(baseUrl);
  }

  const searchParams = request.nextUrl.searchParams;
  const redirectTo = searchParams.get('redirectTo') || '/';

  return signIn(redirectTo);
}
```

### `app/api/auth/sign-out/route.ts`

```typescript
import { signOut } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  return signOut();
}

export async function POST() {
  return signOut();
}
```

### `app/api/auth/callback/route.ts`

```typescript
import { NextRequest } from 'next/server';
import { handleCallback } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleCallback(request);
}
```

### `app/api/auth/user/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const context = await getUser();

  if (!context.isAuthenticated) {
    return NextResponse.json(
      { isAuthenticated: false, user: null },
      { status: 401 },
    );
  }

  return NextResponse.json({
    isAuthenticated: true,
    user: {
      id: context.userInfo?.sub,
      name: context.userInfo?.name,
      email: context.userInfo?.email,
      picture: context.userInfo?.picture,
      username: context.userInfo?.username,
    },
  });
}
```

---

## 5. Next.js 中间件

### `middleware.ts`

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const PROTECTED_ROUTES = [
  '/chat',
  '/api/chat',
  '/api/deployments',
  '/api/vercel',
  '/api/netlify',
  '/api/github',
  '/api/cos',
  '/api/1panel',
  '/api/upload',
];

const PUBLIC_ROUTES = [
  '/api/auth',
  '/api/health',
  '/api/system',
  '/_next',
  '/favicon.ico',
];

function matchesRoute(pathname: string, routes: string[]): boolean {
  return routes.some(route => pathname.startsWith(route));
}

function shouldEnforceAuth(): boolean {
  return process.env.LOGTO_ENABLE === 'true';
}

async function verifySession(request: NextRequest): Promise<boolean> {
  const secret = new TextEncoder().encode(
    process.env.LOGTO_COOKIE_SECRET || 's3cr3t'
  );

  // 检查 Logto 会话
  const logtoSession = request.cookies.get('logto_session')?.value;
  if (logtoSession) {
    try {
      await jwtVerify(logtoSession, secret);
      return true;
    } catch {}
  }

  // 检查虚拟用户会话
  const virtualUser = request.cookies.get('virtual_user')?.value;
  if (virtualUser) {
    try {
      await jwtVerify(virtualUser, secret);
      return true;
    } catch {}
  }

  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 公开路由直接放行
  if (matchesRoute(pathname, PUBLIC_ROUTES)) {
    return NextResponse.next();
  }

  // 开发环境不启用认证时，直接放行
  if (!shouldEnforceAuth()) {
    return NextResponse.next();
  }

  // 检查是否是受保护的路由
  if (matchesRoute(pathname, PROTECTED_ROUTES)) {
    const isAuthenticated = await verifySession(request);

    if (!isAuthenticated) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Unauthorized', message: '请先登录', code: 401 },
          { status: 401 },
        );
      }

      const signInUrl = new URL('/api/auth/sign-in', request.url);
      signInUrl.searchParams.set('redirectTo', pathname);
      return NextResponse.redirect(signInUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
```

---

## 6. 使用示例

### Server Component 中使用

```typescript
// app/(main)/chat/[id]/page.tsx
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';

interface Props {
  params: { id: string };
}

export default async function ChatPage({ params }: Props) {
  const { userInfo } = await requireUser();
  const userId = userInfo?.sub;

  const chat = await prisma.chat.findFirst({
    where: { urlId: params.id, userId },
    include: { messages: true },
  });

  if (!chat) notFound();

  return (
    <div>
      <h1>Chat: {chat.description}</h1>
    </div>
  );
}
```

### API Route 中使用

```typescript
// app/api/chat/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const authResult = await requireAuth({ isApi: true });

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { userInfo } = authResult;
  const userId = userInfo?.sub;

  const body = await request.json();

  return NextResponse.json({ success: true, userId });
}
```

### Client Component 中使用

```typescript
// components/user-menu.tsx
'use client';

import { useEffect, useState } from 'react';

interface User {
  id: string;
  name: string;
  email: string;
  picture: string;
}

export function UserMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/user')
      .then(res => res.json())
      .then(data => {
        if (data.isAuthenticated) {
          setUser(data.user);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>加载中...</div>;

  if (!user) {
    return <a href="/api/auth/sign-in">登录</a>;
  }

  return (
    <div>
      <img src={user.picture} alt={user.name} />
      <span>{user.name}</span>
      <a href="/api/auth/sign-out">退出</a>
    </div>
  );
}
```

---

## 7. 安全设计说明

### Cookie 安全配置

```typescript
const COOKIE_CONFIG = {
  httpOnly: true,      // 防止 XSS 攻击读取 Cookie
  path: '/',           // 全站可用
  sameSite: 'lax',     // 防止 CSRF，同时允许顶级导航
  secure: process.env.NODE_ENV === 'production',  // 生产环境强制 HTTPS
  maxAge: 60 * 60 * 24 * 30,  // 30 天有效期
};
```

| 配置 | 值 | 安全作用 |
|------|------|---------|
| `httpOnly` | `true` | JavaScript 无法读取，防 XSS |
| `sameSite` | `'lax'` | 跨站请求不发送，防 CSRF |
| `secure` | 生产 `true` | 仅 HTTPS 传输，防中间人 |
| `maxAge` | 30 天 | 限制有效期，降低泄露风险 |

### JWT 加密 Cookie

```typescript
async function encryptSession(data: Record<string, unknown>): Promise<string> {
  return new SignJWT(data)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSecretKey());
}
```

| 方案 | 优点 | 缺点 |
|------|------|------|
| **JWT 加密 Cookie** ✅ | 无状态、可验证、防篡改 | Cookie 大小限制 4KB |
| 明文 Cookie | 简单 | 不安全，可被篡改 |
| Session ID + Redis | 存储大数据 | 需要额外基础设施 |

### 为什么 API Routes 需要 `dynamic = 'force-dynamic'`？

```typescript
export const dynamic = 'force-dynamic';
```

Next.js 默认会尝试静态化 API Routes。对于认证相关的路由：

| 问题 | 不加 `force-dynamic` | 加了 `force-dynamic` |
|------|---------------------|---------------------|
| Cookie 读写 | 可能失败 | 正常工作 |
| 环境变量 | 构建时固定 | 运行时读取 |
| 用户状态 | 可能缓存错误状态 | 每次请求重新计算 |

---

## 8. 依赖安装

```bash
pnpm add @logto/next jose
```

---

## 9. 环境变量

```env
# .env.local

# 是否启用认证（开发环境可设为 false）
LOGTO_ENABLE=false

# Logto 服务器地址
LOGTO_ENDPOINT=https://your-logto-endpoint.logto.app

# Logto 应用 ID
LOGTO_APP_ID=your-app-id

# Logto 应用密钥
LOGTO_APP_SECRET=your-app-secret

# 应用基础 URL
LOGTO_BASE_URL=http://localhost:3000

# Cookie 加密密钥（至少 32 字符）
LOGTO_COOKIE_SECRET=your-super-secret-key-at-least-32-chars
```

---

## 10. 迁移检查清单

- [x] 安装依赖：`@logto/next`, `jose`
- [x] 创建 `lib/auth/` 目录：
  - [x] `lib/auth/types.ts` - 类型定义
  - [x] `lib/auth/auth.ts` - 认证核心逻辑
  - [x] `lib/auth/index.ts` - 统一导出
- [x] 创建 API 路由：
  - [x] `app/api/auth/sign-in/route.ts`
  - [x] `app/api/auth/sign-out/route.ts`
  - [x] `app/api/auth/callback/route.ts`
  - [x] `app/api/auth/user/route.ts`
- [ ] 创建 `middleware.ts`
- [ ] 配置环境变量
- [ ] 在 Logto 后台配置回调 URL：`{YOUR_BASE_URL}/api/auth/callback`
- [ ] 测试开发模式（LOGTO_ENABLE=false）
- [ ] 测试生产模式认证流程
