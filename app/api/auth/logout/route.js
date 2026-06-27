import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/app/lib/server/auth';

export async function POST(request) {
  await clearSessionCookie(request);
  return NextResponse.json({ ok: true });
}
