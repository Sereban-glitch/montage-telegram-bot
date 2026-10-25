import { NextRequest, NextResponse } from 'next/server';
import { boot } from '@/lib/boot';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

// GET /api/admin/events — хвост лога воркера (терминал в админке)
export async function GET(req: NextRequest) {
  await boot();
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const limit = Math.min(200, Number(req.nextUrl.searchParams.get('limit') ?? 40));
  const events = await db.event.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { job: { select: { type: true } } },
  });
  return NextResponse.json({ events });
}
