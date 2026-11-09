import fs from 'node:fs';
import path from 'node:path';
import { PROJECTS_ROOT } from '@/lib/project';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HIDE = new Set(['node_modules', '.git', '.next', '.ai-office-backup', 'dist', 'build', '__pycache__', '.venv', 'venv']);
const PROJECT_MARKS = ['package.json', '.git', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml', 'pom.xml', 'composer.json', 'index.html'];

/** แปลง path แบบสัมพันธ์กับ PROJECTS_ROOT เป็น path จริง และบังคับให้อยู่ใน root (อนุญาตตัว root เองสำหรับการเปิดดู) */
function inRoot(rel: string): { root: string; abs: string } {
  if (!PROJECTS_ROOT) throw new Error('ยังไม่ได้ตั้ง PROJECTS_ROOT ในไฟล์ .env');
  const root = fs.realpathSync(PROJECTS_ROOT);
  const abs = fs.realpathSync(path.resolve(root, rel || '.'));
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('อยู่นอกโฟลเดอร์ที่อนุญาต');
  if (!fs.statSync(abs).isDirectory()) throw new Error('ไม่ใช่โฟลเดอร์');
  return { root, abs };
}

const err = (e: unknown, status = 400) => Response.json({ error: e instanceof Error ? e.message : 'error' }, { status });

export async function GET(request: Request) {
  try {
    const rel = new URL(request.url).searchParams.get('path') ?? '';
    const { root, abs } = inRoot(rel);
    const dirs = fs.readdirSync(abs, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !HIDE.has(d.name))
      .map((d) => {
        const full = path.join(abs, d.name);
        let isProject = false;
        try { isProject = PROJECT_MARKS.some((m) => fs.existsSync(path.join(full, m))); } catch { /* ไม่มีสิทธิ์อ่าน */ }
        return { name: d.name, rel: path.relative(root, full), isProject };
      })
      .sort((a, b) => Number(b.isProject) - Number(a.isProject) || a.name.localeCompare(b.name));
    const current = path.relative(root, abs);
    return Response.json({
      root, current, abs,
      parent: current ? path.dirname(current).replace(/^\.$/, '') : null,
      dirs,
    });
  } catch (e) {
    return err(e);
  }
}

/** สร้างโฟลเดอร์ใหม่ใต้ parent (ใช้ตอนโหมด "สร้างใหม่") */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { parent?: unknown; name?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80 || /[\\/:*?"<>|]/.test(name) || name.startsWith('.')) throw new Error('ชื่อโฟลเดอร์ไม่ถูกต้อง');
    const { root, abs } = inRoot(typeof body.parent === 'string' ? body.parent : '');
    const target = path.join(abs, name);
    if (fs.existsSync(target)) throw new Error('มีโฟลเดอร์ชื่อนี้อยู่แล้ว');
    fs.mkdirSync(target);
    return Response.json({ rel: path.relative(root, target) });
  } catch (e) {
    return err(e);
  }
}
