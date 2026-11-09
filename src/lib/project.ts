// จัดการโปรเจกต์เก่าของผู้ใช้: ตรวจ path ให้อยู่ใน PROJECTS_ROOT, คัดลอกมาทำงานบนสำเนา,
// คำนวณ diff, และ "นำไปใช้" กลับไปยังโปรเจกต์จริง (พร้อมสำรองไฟล์เดิม + ตรวจว่าไฟล์จริงไม่ถูกแก้ระหว่างทาง)

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ถ้าไม่ตั้ง PROJECTS_ROOT จะใช้โฟลเดอร์แม่ของแอปนี้เป็นค่าเริ่มต้น (คลิกเลือกโปรเจกต์ได้เลยโดยไม่ต้องตั้งค่า)
export const PROJECTS_ROOT: string | null = process.env.PROJECTS_ROOT
  ? path.resolve(process.env.PROJECTS_ROOT)
  : path.resolve(process.cwd(), '..');
export const WORKSPACE = path.join(process.cwd(), 'workspace');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.svelte-kit', 'dist', 'build', 'out', 'coverage', '.turbo',
  '.venv', 'venv', '__pycache__', '.idea', '.vscode', 'target', 'vendor', 'workspace', '.ai-office-backup',
]);
const SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.pdf', '.zip', '.gz', '.tar', '.7z', '.woff', '.woff2',
  '.ttf', '.otf', '.eot', '.mp3', '.mp4', '.mov', '.wasm', '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.lock',
  '.sqlite', '.db', '.pyc',
]);
const SECRET_RE = /^(\.env(\..*)?|.*\.pem|.*\.key|id_rsa.*|id_ed25519.*|credentials.*|.*secret.*\.json)$/i;
const MAX_FILE = 300 * 1024;
const MAX_FILES = 1500;
const MAX_TOTAL = 15 * 1024 * 1024;

export type Mode = 'new' | 'modify' | 'review';

// ---------- path ----------

/** แปลง path ที่ผู้ใช้พิมพ์ (absolute หรือสัมพันธ์กับ PROJECTS_ROOT) และตรวจว่าอยู่ใน root จริง */
export function resolveInRoot(input: string, { mustExist }: { mustExist: boolean }): string {
  if (!PROJECTS_ROOT) throw new Error('ยังไม่ได้ตั้ง PROJECTS_ROOT ในไฟล์ .env — ใส่โฟลเดอร์แม่ของโปรเจกต์ แล้วรันใหม่');
  const root = fs.realpathSync(PROJECTS_ROOT);
  let p = path.resolve(PROJECTS_ROOT, input.trim());
  if (fs.existsSync(p)) p = fs.realpathSync(p);
  else if (mustExist) throw new Error(`ไม่พบโฟลเดอร์: ${input}`);
  if (p === root || !p.startsWith(root + path.sep)) throw new Error(`path ต้องอยู่ใต้ ${root} (และไม่ใช่โฟลเดอร์ root เอง)`);
  if (fs.existsSync(p) && !fs.statSync(p).isDirectory()) throw new Error('path ต้องเป็นโฟลเดอร์');
  return p;
}

export const hashBuf = (b: Buffer | string) => crypto.createHash('sha1').update(b).digest('hex');
const hashFile = (p: string): string | null => (fs.existsSync(p) && fs.statSync(p).isFile() ? hashBuf(fs.readFileSync(p)) : null);

// ---------- คัดลอก / ดูโครงสร้าง ----------

function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, 4096).includes(0);
}

/** คัดลอกเฉพาะไฟล์ข้อความที่ปลอดภัยมาไว้ที่ dest (ข้าม node_modules, .git, ไฟล์ลับ ฯลฯ) */
export function copyProject(src: string, dest: string): { files: number; bytes: number; skipped: number } {
  let files = 0, bytes = 0, skipped = 0;
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) { skipped++; continue; }
      if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name)) walk(full); continue; }
      if (!ent.isFile()) continue;
      if (SECRET_RE.test(ent.name) || SKIP_EXT.has(path.extname(ent.name).toLowerCase())) { skipped++; continue; }
      const st = fs.statSync(full);
      if (st.size > MAX_FILE) { skipped++; continue; }
      const buf = fs.readFileSync(full);
      if (isBinary(buf)) { skipped++; continue; }
      if (++files > MAX_FILES || (bytes += st.size) > MAX_TOTAL)
        throw new Error('โปรเจกต์ใหญ่เกินไป (เกิน 1,500 ไฟล์ หรือ 15MB) — ชี้ไปที่โฟลเดอร์ย่อยแทน');
      const out = path.join(dest, path.relative(src, full));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, buf);
    }
  };
  fs.mkdirSync(dest, { recursive: true });
  walk(src);
  return { files, bytes, skipped };
}

export function listFiles(dir: string): { path: string; size: number }[] {
  const out: { path: string; size: number }[] = [];
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) out.push({ path: path.relative(dir, full).split(path.sep).join('/'), size: fs.statSync(full).size });
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function treeText(dir: string, maxLines = 400): string {
  const all = listFiles(dir);
  const lines = all.slice(0, maxLines).map((f) => `${f.path}  (${f.size}B)`);
  if (all.length > maxLines) lines.push(`... และอีก ${all.length - maxLines} ไฟล์`);
  return lines.join('\n') || '(โฟลเดอร์ว่าง)';
}

export function readText(dir: string, rel: string, limit = 12000): string | null {
  const full = path.join(dir, rel);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  const s = fs.readFileSync(full, 'utf8');
  return s.length > limit ? s.slice(0, limit) + '\n...(ตัดทอน)' : s;
}

// ---------- manifest ของแต่ละรอบงาน ----------

export interface Manifest {
  runId: string;
  mode: Mode;
  target: string | null;
  createdAt: string;
  touched: string[];
  /** hash ของไฟล์ปลายทาง ณ ตอนที่ AI แตะไฟล์ครั้งแรก (null = ยังไม่มีไฟล์) ใช้ตรวจว่าไฟล์จริงถูกแก้ระหว่างทางไหม */
  base: Record<string, string | null>;
  applied?: { at: string; backupDir: string | null; files: string[] };
}

const manifestPath = (runId: string) => path.join(WORKSPACE, `${runId}.meta.json`);
const SAFE_ID = /^[0-9A-Za-z_-]+$/;

export function writeManifest(m: Manifest) {
  fs.mkdirSync(WORKSPACE, { recursive: true });
  fs.writeFileSync(manifestPath(m.runId), JSON.stringify(m, null, 2));
}
export function readManifest(runId: string): Manifest {
  if (!SAFE_ID.test(runId) || !fs.existsSync(manifestPath(runId))) throw new Error('ไม่พบรอบงานนี้');
  return JSON.parse(fs.readFileSync(manifestPath(runId), 'utf8')) as Manifest;
}

/** บันทึกว่า AI แตะไฟล์นี้ (เรียกก่อนเขียนไฟล์ครั้งแรก) */
export function markTouched(m: Manifest, rel: string) {
  if (m.touched.includes(rel)) return;
  m.touched.push(rel);
  m.base[rel] = m.target ? hashFile(path.join(m.target, rel)) : null;
  writeManifest(m);
}

// ---------- diff ----------

/** unified diff แบบย่อ (LCS ระดับบรรทัด) — ไม่ต้องพึ่งคำสั่ง diff ของเครื่อง */
export function lineDiff(oldText: string, newText: string, context = 3): string {
  const a = oldText.split('\n'), b = newText.split('\n');
  if (a.length * b.length > 4_000_000) return '(ไฟล์ใหญ่เกินกว่าจะแสดง diff แบบละเอียด)';
  const n = a.length, m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const ops: { t: ' ' | '-' | '+'; s: string }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: ' ', s: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ t: '-', s: a[i++] });
    else ops.push({ t: '+', s: b[j++] });
  }
  while (i < n) ops.push({ t: '-', s: a[i++] });
  while (j < m) ops.push({ t: '+', s: b[j++] });

  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((o, k) => {
    if (o.t !== ' ') for (let x = Math.max(0, k - context); x <= Math.min(ops.length - 1, k + context); x++) keep[x] = true;
  });
  const out: string[] = [];
  let skipping = false;
  ops.forEach((o, k) => {
    if (keep[k]) { out.push(o.t + o.s); skipping = false; }
    else if (!skipping) { out.push('…'); skipping = true; }
  });
  return out.join('\n');
}

export interface Change {
  path: string;
  status: 'added' | 'modified';
  diff: string;
  /** ไฟล์จริงถูกแก้หลังจากที่ AI เริ่มทำงาน — จะไม่ถูกเขียนทับ */
  conflict: boolean;
}

/** เปรียบเทียบไฟล์ที่ AI แตะ (ในสำเนา) กับไฟล์จริงในปลายทาง ณ ตอนนี้ */
export function computeChanges(m: Manifest): Change[] {
  if (!m.target) return [];
  const runDir = path.join(WORKSPACE, m.runId);
  const changes: Change[] = [];
  for (const rel of m.touched) {
    const mine = path.join(runDir, rel), real = path.join(m.target, rel);
    if (!fs.existsSync(mine)) continue;
    const newText = fs.readFileSync(mine, 'utf8');
    const exists = fs.existsSync(real);
    const oldText = exists ? fs.readFileSync(real, 'utf8') : '';
    if (exists && oldText === newText) continue;
    const conflict = exists ? hashFile(real) !== m.base[rel] : m.base[rel] !== null;
    changes.push({
      path: rel, status: exists ? 'modified' : 'added', conflict,
      diff: exists ? lineDiff(oldText, newText) : newText.split('\n').map((l) => '+' + l).join('\n'),
    });
  }
  return changes;
}

export interface ApplyResult { applied: string[]; skipped: string[]; backupDir: string | null }

/** เขียนไฟล์ที่ AI แก้กลับไปยังโปรเจกต์จริง โดยสำรองไฟล์เดิมไว้ใน .ai-office-backup/<runId>/ */
export function applyChanges(runId: string): ApplyResult {
  const m = readManifest(runId);
  if (!m.target) throw new Error('รอบงานนี้ไม่มีโปรเจกต์ปลายทาง');
  if (m.applied) throw new Error('รอบงานนี้นำไปใช้แล้ว');
  const target = resolveInRoot(m.target, { mustExist: false });
  const runDir = path.join(WORKSPACE, runId);
  const backupDir = path.join(target, '.ai-office-backup', runId);
  const applied: string[] = [], skipped: string[] = [];
  let backedUp = false;

  for (const c of computeChanges(m)) {
    if (c.conflict) { skipped.push(c.path); continue; }
    const real = path.resolve(target, c.path);
    if (!real.startsWith(target + path.sep)) { skipped.push(c.path); continue; }
    if (fs.existsSync(real)) {
      const bak = path.join(backupDir, c.path);
      fs.mkdirSync(path.dirname(bak), { recursive: true });
      fs.copyFileSync(real, bak);
      backedUp = true;
    }
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.copyFileSync(path.join(runDir, c.path), real);
    applied.push(c.path);
  }
  m.applied = { at: new Date().toISOString(), backupDir: backedUp ? backupDir : null, files: applied };
  writeManifest(m);
  return { applied, skipped, backupDir: backedUp ? backupDir : null };
}

// ---------- ไฟล์ผลงานของรอบงาน (ใช้ตอนดาวน์โหลด) ----------

/** ไฟล์ที่ควรให้ผู้ใช้เอาไปได้: โหมดสร้างใหม่ = ทุกไฟล์ · แก้โปรเจกต์ = เฉพาะไฟล์ที่ AI แตะ · รีวิว = REVIEW.md */
export function runFiles(runId: string): { mode: Mode; dir: string; files: { path: string; size: number }[] } {
  const m = readManifest(runId);
  const dir = path.join(WORKSPACE, runId);
  const all = listFiles(dir);
  let files = all;
  if (m.mode === 'modify') files = all.filter((f) => m.touched.includes(f.path));
  else if (m.mode === 'review') files = all.filter((f) => f.path === 'REVIEW.md');
  return { mode: m.mode, dir, files };
}
