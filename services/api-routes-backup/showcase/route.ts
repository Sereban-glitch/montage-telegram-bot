import { NextRequest, NextResponse } from 'next/server';
import { boot } from '@/lib/boot';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/showcase — витрина готовых работ
export async function GET(req: NextRequest) {
  await boot();
  const kind = req.nextUrl.searchParams.get('kind');
  const items = await db.showcaseItem.findMany({
    where: kind ? { kind } : undefined,
    orderBy: [{ featured: 'desc' }, { sort: 'asc' }],
  });
  return NextResponse.json({ items });
}

// POST /api/showcase/[id]/view — не используется, просмотры меняются из админки
export async function POST(req: NextRequest) {
  await boot();
  const body = await req.json().catch(() => ({}));
  const id: string | undefined = body.id;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const item = await db.showcaseItem.update({ where: { id }, data: { views: { increment: 1 } } });
  return NextResponse.json({ item });
}
