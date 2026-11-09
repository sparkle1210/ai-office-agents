import { runFiles } from '@/lib/project';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** รายการไฟล์ผลงานของรอบงาน (ใช้เขียนลงโฟลเดอร์ที่ผู้ใช้เลือก) */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { mode, files } = runFiles(id);
    return Response.json({ id, mode, files });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : 'error', { status: 404 });
  }
}
