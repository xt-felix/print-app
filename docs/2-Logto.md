# Next.js Logto 认证实现指南

本文档详细说明如何将现有的 Remix Logto 认证迁移到 Next.js。

---

## 架构设计理念

### 为什么采用这种分层架构？

```
┌─────────────────────────────────────────────────────────────┐
│                      middleware.ts                          │
│              (Edge Runtime - 快速拦截)                       │
├─────────────────────────────────────────────────────────────┤
│                    API Routes                               │
│    sign-in / sign-out / callback / user                     │
│              (HTTP 端点 - OAuth 流程)                        │
├─────────────────────────────────────────────────────────────┤
│                     lib/auth/                               │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌──────────┐      │
│  │ logto.ts│  │session.ts│  │config.ts│  │ types.ts │      │
│  │ (核心)  │  │ (会话)   │  │ (配置)  │  │ (类型)   │      │
│  └─────────┘  └──────────┘  └─────────┘  └──────────┘      │
│              (Node.js Runtime - 完整功能)                    │
└─────────────────────────────────────────────────────────────┘
```

#### 1. 分离关注点 (Separation of Concerns)

| 文件 | 职责 | 为什么分离 |
|------|------|-----------|
| `types.ts` | 类型定义 | 避免循环依赖，提供清晰的接口契约 |
| `config.ts` | 配置管理 | 集中管理环境变量，便于修改和测试 |
| `session.ts` | 会话存储 | Cookie 操作独立，可替换存储方案 |
| `logto.ts` | 核心逻辑 | 认证业务逻辑集中，便于维护 |
| `index.ts` | 统一导出 | 简化外部导入，控制公开 API |

#### 2. 双运行时设计

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

#### 3. 三级用户优先级

```typescript
// getUser() 的优先级设计
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

**为什么需要这三级？**

| 级别 | 场景 | 用途 |
|------|------|------|
| Mock 用户 | `LOGTO_ENABLE=false` | 开发环境无需配置 Logto 即可运行 |
| 虚拟用户 | 管理后台代登录 | 客服/管理员模拟用户操作 |
| 真实用户 | 生产环境 | 正常的 OAuth 认证流程 |

---

### 为什么使用 JWT 加密 Cookie？

```typescript
// session.ts 中的加密逻辑
async function encryptSession(data: Record<string, unknown>): Promise<string> {
  return new SignJWT(data)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSecretKey());
}
```

**对比其他方案：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| **JWT 加密 Cookie** ✅ | 无状态、可验证、防篡改 | Cookie 大小限制 4KB |
| 明文 Cookie | 简单 | 不安全，可被篡改 |
| Session ID + Redis | 存储大数据 | 需要额外基础设施 |
| LocalStorage | 存储大 | 仅客户端，XSS 风险 |

**选择 JWT Cookie 的原因：**
1. **无状态** - 不需要 Redis 等外部存储
2. **可验证** - middleware 可以快速验证签名
3. **防篡改** - HMAC 签名保证数据完整性
4. **自动过期** - JWT 内置 `exp` 声明

---

### 为什么 API Routes 需要 `dynamic = 'force-dynamic'`？

```typescript
// app/api/auth/sign-in/route.ts
export const dynamic = 'force-dynamic';
```

**Next.js 默认会尝试静态化 API Routes。** 对于认证相关的路由：

| 问题 | 不加 `force-dynamic` | 加了 `force-dynamic` |
|------|---------------------|---------------------|
| Cookie 读写 | 可能失败 | 正常工作 |
| 环境变量 | 构建时固定 | 运行时读取 |
| 用户状态 | 可能缓存错误状态 | 每次请求重新计算 |

---

### Middleware vs API Route 认证检查

```
请求流程:
┌────────┐    ┌────────────┐    ┌────────────┐    ┌──────────┐
│ Client │───▶│ Middleware │───▶│ API Route  │───▶│ Handler  │
└────────┘    │ (快速检查) │    │ (详细检查) │    └──────────┘
              └────────────┘    └────────────┘
                   │                  │
                   ▼                  ▼
              JWT 签名验证       完整认证上下文
              (仅检查有效性)     (获取用户信息)
```

**为什么需要两层检查？**

| 层级 | Middleware | API Route (`requireAuth`) |
|------|------------|--------------------------|
| 运行位置 | Edge | Node.js |
| 检查内容 | JWT 签名有效性 | 完整用户信息 |
| 性能 | 极快 (< 1ms) | 较慢 (可能调用 Logto API) |
| 职责 | 拦截明显无效请求 | 获取业务需要的用户数据 |

**示例：受保护的 API**
```typescript
export async function POST(request: NextRequest) {
  // 1. Middleware 已经做了基本 JWT 验证
  // 2. 这里获取完整用户信息用于业务逻辑
  const authResult = await requireAuth({ isApi: true });

  if (authResult instanceof NextResponse) {
    return authResult; // 未认证
  }

  const userId = authResult.userInfo?.sub;
  // ... 使用 userId 进行业务操作
}
```

---

### Cookie 安全配置解释

```typescript
export const cookieConfig = {
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

---

### 错误处理策略

```typescript
// handleCallback 中的错误处理
export async function handleCallback(request: Request): Promise<Response> {
  try {
    // ... 正常流程
  } catch (error) {
    // 1. 记录详细错误（服务端日志）
    console.error('[Auth] 回调处理失败:', error);

    // 2. 给用户友好提示（不暴露技术细节）
    let errorMessage = '登录失败，请稍后再试';

    if (error instanceof Error) {
      if (error.message.includes('fetch failed')) {
        errorMessage = '无法连接到认证服务器，请检查网络连接';
      }
    }

    // 3. 存储错误到 Cookie（用于前端显示）
    await setAuthError(errorMessage);

    // 4. 重定向回首页
    return Response.redirect(logtoConfig.baseUrl);
  }
}
```

**设计原则：**
1. **不暴露技术细节** - 用户看到友好提示，不是堆栈跟踪
2. **日志记录完整** - 开发者可以排查问题
3. **优雅降级** - 出错也能继续使用应用

---

## 目录结构

```
lib/
├── auth/
│   ├── config.ts          # Logto 配置
│   ├── session.ts         # Cookie 会话管理
│   ├── logto.ts           # Logto 客户端
│   ├── index.ts           # 导出入口
│   └── types.ts           # 类型定义

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
```

---

## 2. 配置文件

### `lib/auth/config.ts`

```typescript
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
```

---

## 3. Cookie 会话管理

### `lib/auth/session.ts`

```typescript
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import type { UserInfo, VirtualUser } from './types';
import { logtoConfig, cookieConfig } from './config';

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
```

---

## 4. Logto 客户端

### `lib/auth/logto.ts`

```typescript
import LogtoClient from '@logto/next/server-actions';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import type { AuthContext, MockUser, RequireAuthOptions } from './types';
import { logtoConfig, shouldEnforceAuth, authRoutes } from './config';
import {
  getLogtoSession,
  setLogtoSession,
  clearLogtoSession,
  getVirtualUser,
  clearVirtualUser,
  setAuthError,
} from './session';
import { createScopedLogger } from '@/lib/utils/logger';

const logger = createScopedLogger('auth');

// ============================================
// Logto 客户端实例
// ============================================

const logtoClient = new LogtoClient({
  endpoint: logtoConfig.endpoint,
  appId: logtoConfig.appId,
  appSecret: logtoConfig.appSecret,
  baseUrl: logtoConfig.baseUrl,
  cookieSecret: logtoConfig.cookieSecret,
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
    const context = await logtoClient.getContext({ fetchUserInfo: true });

    if (context.isAuthenticated && context.userInfo) {
      return {
        isAuthenticated: true,
        userInfo: context.userInfo,
        claims: context.claims,
      };
    }
  } catch (error) {
    logger.error('[Auth] 获取 Logto 上下文失败:', error);
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
export async function requireAuth(
  options: RequireAuthOptions = {}
): Promise<AuthContext | NextResponse> {
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
        { status: 401 }
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
export async function signIn(redirectUri?: string): Promise<Response> {
  try {
    const signInUrl = await logtoClient.handleSignIn(
      `${logtoConfig.baseUrl}${authRoutes.callback}`,
      redirectUri
    );
    return Response.redirect(signInUrl);
  } catch (error) {
    logger.error('[Auth] 登录失败:', error);
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
      logger.info('[Auth] 虚拟用户退出登录');
      await clearVirtualUser();
      return Response.redirect(logtoConfig.baseUrl);
    }

    // Logto 用户登出
    await clearLogtoSession();
    const signOutUrl = await logtoClient.handleSignOut(logtoConfig.baseUrl);
    return Response.redirect(signOutUrl);
  } catch (error) {
    logger.error('[Auth] 登出失败:', error);
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
    await logtoClient.handleSignInCallback(url.toString());

    // 获取用户信息并存储到会话
    const context = await logtoClient.getContext({ fetchUserInfo: true });

    if (context.isAuthenticated && context.userInfo) {
      await setLogtoSession({
        userInfo: context.userInfo,
      });
    }

    // 重定向到首页或指定页面
    const redirectTo = url.searchParams.get('redirectTo') || authRoutes.home;
    return Response.redirect(`${logtoConfig.baseUrl}${redirectTo}`);
  } catch (error) {
    logger.error('[Auth] 回调处理失败:', error);

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

// ============================================
// 导出 Logto 客户端实例（用于高级用法）
// ============================================

export { logtoClient };
```

---

## 5. 导出入口

### `lib/auth/index.ts`

```typescript
// 类型导出
export type {
  LogtoConfig,
  UserInfo,
  AuthContext,
  MockUser,
  VirtualUser,
  LogtoUser,
  RequireAuthOptions,
} from './types';

// 配置导出
export { logtoConfig, cookieConfig, authRoutes, shouldEnforceAuth } from './config';

// 会话管理导出
export {
  setLogtoSession,
  getLogtoSession,
  clearLogtoSession,
  setVirtualUser,
  getVirtualUser,
  clearVirtualUser,
  setAuthError,
  getAuthError,
} from './session';

// 核心认证方法导出
export {
  getUser,
  requireUser,
  requireAuth,
  signIn,
  signOut,
  handleCallback,
  logtoClient,
} from './logto';
```

---

## 6. API 路由实现

### `app/api/auth/sign-in/route.ts`

```typescript
import { NextRequest } from 'next/server';
import { signIn, shouldEnforceAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // 开发环境跳过登录
  if (!shouldEnforceAuth()) {
    const baseUrl = process.env.LOGTO_BASE_URL || 'http://localhost:3000';
    return Response.redirect(baseUrl);
  }

  // 获取重定向地址
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
      {
        isAuthenticated: false,
        user: null,
      },
      { status: 401 }
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

## 7. Next.js 中间件

### `middleware.ts`

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * 需要认证的路由
 */
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

/**
 * 公开路由（不需要认证）
 */
const PUBLIC_ROUTES = [
  '/api/auth',
  '/api/health',
  '/api/system',
  '/_next',
  '/favicon.ico',
];

/**
 * 检查路径是否匹配
 */
function matchesRoute(pathname: string, routes: string[]): boolean {
  return routes.some(route => pathname.startsWith(route));
}

/**
 * 检查是否启用认证
 */
function shouldEnforceAuth(): boolean {
  return process.env.LOGTO_ENABLE === 'true';
}

/**
 * 验证会话 Cookie
 */
async function verifySession(request: NextRequest): Promise<boolean> {
  // 检查 Logto 会话
  const logtoSession = request.cookies.get('logto_session')?.value;
  if (logtoSession) {
    try {
      const secret = new TextEncoder().encode(
        process.env.LOGTO_COOKIE_SECRET || 's3cr3t'
      );
      await jwtVerify(logtoSession, secret);
      return true;
    } catch {
      // 会话无效
    }
  }

  // 检查虚拟用户会话
  const virtualUser = request.cookies.get('virtual_user')?.value;
  if (virtualUser) {
    try {
      const secret = new TextEncoder().encode(
        process.env.LOGTO_COOKIE_SECRET || 's3cr3t'
      );
      await jwtVerify(virtualUser, secret);
      return true;
    } catch {
      // 会话无效
    }
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
      // API 路由返回 401
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          {
            error: 'Unauthorized',
            message: '请先登录',
            code: 401,
          },
          { status: 401 }
        );
      }

      // 页面路由重定向到登录
      const signInUrl = new URL('/api/auth/sign-in', request.url);
      signInUrl.searchParams.set('redirectTo', pathname);
      return NextResponse.redirect(signInUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * 匹配所有路径，除了：
     * - _next/static (静态文件)
     * - _next/image (图片优化)
     * - favicon.ico (网站图标)
     * - public 文件夹中的文件
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
```

---

## 8. 在页面中使用

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
  // 验证用户认证
  const { userInfo } = await requireUser();
  const userId = userInfo?.sub;

  // 获取聊天数据
  const chat = await prisma.chat.findFirst({
    where: {
      urlId: params.id,
      userId,
    },
    include: {
      messages: true,
    },
  });

  if (!chat) {
    notFound();
  }

  return (
    <div>
      <h1>Chat: {chat.description}</h1>
      {/* 渲染聊天内容 */}
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
  // 验证认证
  const authResult = await requireAuth({ isApi: true });

  // 如果返回 Response，说明未认证
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { userInfo } = authResult;
  const userId = userInfo?.sub;

  // 处理请求...
  const body = await request.json();

  return NextResponse.json({
    success: true,
    userId,
    // ...其他数据
  });
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

  if (loading) {
    return <div>加载中...</div>;
  }

  if (!user) {
    return (
      <a href="/api/auth/sign-in">
        登录
      </a>
    );
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

## 9. 依赖安装

```bash
pnpm add @logto/next jose
```

---

## 10. 环境变量

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

## 迁移检查清单

- [ ] 安装依赖：`@logto/next`, `jose`
- [ ] 创建 `lib/auth/` 目录及所有文件
- [ ] 创建 API 路由：
  - [ ] `app/api/auth/sign-in/route.ts`
  - [ ] `app/api/auth/sign-out/route.ts`
  - [ ] `app/api/auth/callback/route.ts`
  - [ ] `app/api/auth/user/route.ts`
- [ ] 创建 `middleware.ts`
- [ ] 配置环境变量
- [ ] 在 Logto 后台配置回调 URL：`{YOUR_BASE_URL}/api/auth/callback`
- [ ] 测试开发模式（LOGTO_ENABLE=false）
- [ ] 测试生产模式认证流程
