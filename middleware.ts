import { jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * 需要认证的路由
 */
const PROTECTED_ROUTES = ['/chat', '/api/chat', '/api/deployments', '/api/upload'];

/**
 * 公开路由（不需要认证）
 */
const PUBLIC_ROUTES = ['/api/auth', '/api/health', '/api/system', '/_next', '/favicon.ico'];

/**
 * 检查路径是否匹配
 */
function matchesRoute(pathname: string, routes: string[]): boolean {
  return routes.some((route) => pathname.startsWith(route));
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
      const secret = new TextEncoder().encode(process.env.LOGTO_COOKIE_SECRET || 's3cr3t');
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
      const secret = new TextEncoder().encode(process.env.LOGTO_COOKIE_SECRET || 's3cr3t');
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
          { status: 401 },
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
