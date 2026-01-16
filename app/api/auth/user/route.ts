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
