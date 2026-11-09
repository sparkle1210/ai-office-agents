import { computeChanges, readManifest } from '@/lib/project';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** รายการไฟล์ที่ AI แก้ + diff เทียบกับไฟล์จริงในโปรเจกต์ ณ ตอนนี้ */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const m = readManifest(id);
    return Response.json({
      id, mode: m.mode, target: m.target, applied: m.applied ?? null, changes: computeChanges(m),
    });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : 'error', { status: 404 });
  }
}
