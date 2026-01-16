import { signOut } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  return signOut();
}

export async function POST() {
  return signOut();
}
