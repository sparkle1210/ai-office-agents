import { applyChanges } from '@/lib/project';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** ผู้ใช้กดอนุมัติ: เขียนไฟล์ที่ AI แก้กลับไปยังโปรเจกต์จริง (สำรองไฟล์เดิมไว้ก่อน) */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return Response.json(applyChanges(id));
  } catch (e) {
    return new Response(e instanceof Error ? e.message : 'error', { status: 400 });
  }
}
