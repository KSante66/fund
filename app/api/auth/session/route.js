import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/app/lib/server/auth';

export async function GET() {
  const session = await getCurrentSession();
  return NextResponse.json({ session });
}
