import { NextRequest, NextResponse } from 'next/server';
import { boot } from '@/lib/boot';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') return null;
  return user;
}

// POST /api/admin/showcase — добавить работу в витрину
export async function POST(req: NextRequest) {
  await boot();
  if (!(await requireAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const { kind, title, subtitle, thumbUrl, videoUrl, durationSec } = body;
  if (!kind || !title || !thumbUrl) {
    return NextResponse.json({ error: 'kind, title, thumbUrl обязательны' }, { status: 400 });
  }
  const maxSort = await db.showcaseItem.aggregate({ _max: { sort: true } });
  const item = await db.showcaseItem.create({
    data: {
      kind: kind === 'long' ? 'long' : 'short',
      title,
      subtitle: subtitle ?? null,
      thumbUrl,
      videoUrl: videoUrl ?? null,
      durationSec: durationSec ? Number(durationSec) : null,
      sort: (maxSort._max.sort ?? 0) + 1,
    },
  });
  return NextResponse.json({ item }, { status: 201 });
}

// DELETE /api/admin/showcase?id=...
export async function DELETE(req: NextRequest) {
  await boot();
  if (!(await requireAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await db.showcaseItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

// PATCH /api/admin/showcase — featured
export async function PATCH(req: NextRequest) {
  await boot();
  if (!(await requireAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const item = await db.showcaseItem.update({
    where: { id: body.id },
    data: { featured: Boolean(body.featured) },
  });
  return NextResponse.json({ item });
}
