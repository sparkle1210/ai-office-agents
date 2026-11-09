import fs from 'node:fs';
import path from 'node:path';
import { runFiles } from '@/lib/project';
import { makeZip } from '@/lib/zip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** ดาวน์โหลดผลงานของรอบงานเป็นไฟล์ .zip */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { mode, dir, files } = runFiles(id);
    if (files.length === 0) return new Response('ยังไม่มีไฟล์ให้ดาวน์โหลด', { status: 404 });
    const zip = makeZip(files.map((f) => ({ name: f.path, data: fs.readFileSync(path.join(dir, f.path)) })));
    const name = `ai-office-${mode}-${id}.zip`;
    return new Response(new Uint8Array(zip), {
      headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${name}"` },
    });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : 'error', { status: 404 });
  }
}
