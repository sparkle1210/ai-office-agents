import fs from 'node:fs';
import path from 'node:path';
import { resolveInRoot, runFiles } from '@/lib/project';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** คัดลอกผลงานของรอบงานไปยังโฟลเดอร์ที่ผู้ใช้คลิกเลือก (ต้องอยู่ใต้ PROJECTS_ROOT) — ไม่เขียนทับไฟล์ที่มีอยู่แล้ว */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json()) as { path?: unknown };
    if (typeof body.path !== 'string' || !body.path.trim()) throw new Error('ยังไม่ได้เลือกโฟลเดอร์');
    const target = resolveInRoot(body.path, { mustExist: true });
    const { dir, files } = runFiles(id);
    const saved: string[] = [], skipped: string[] = [];
    for (const f of files) {
      const dest = path.resolve(target, f.path);
      if (!dest.startsWith(target + path.sep)) { skipped.push(f.path); continue; }
      if (fs.existsSync(dest)) { skipped.push(f.path); continue; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(dir, f.path), dest);
      saved.push(f.path);
    }
    return Response.json({ target, saved, skipped });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : 'error', { status: 400 });
  }
}
