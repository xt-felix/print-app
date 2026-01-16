import { NextRequest } from 'next/server';
import { handleCallback } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleCallback(request);
}
