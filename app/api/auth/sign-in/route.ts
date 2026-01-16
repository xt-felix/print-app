import { NextRequest } from 'next/server';
import { shouldEnforceAuth, signIn } from '@/lib/auth';

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
