// สมองของบริษัท: ควบคุมลำดับงานข้ามแผนก — รองรับ 3 โหมด
//   new     สร้างโปรเจกต์ใหม่ (จะนำไปวางในโฟลเดอร์ปลายทางก็ได้)
//   modify  แก้บั๊ก/เพิ่มฟีเจอร์ในโปรเจกต์เดิม — ทำงานบน "สำเนา" แล้วให้ผู้ใช้ตรวจ diff + กดอนุมัติ
//   review  รีวิว/อธิบายโค้ดอย่างเดียว ไม่แก้ไฟล์
// ลำดับ (new/modify): PM วางแผน → Design → Frontend + Backend → DevOps → QA → แก้บั๊ก → PM สรุป

import fs from 'node:fs';
import path from 'node:path';
import { AGENTS } from './agents';
import * as llm from './llm';
import * as P from './project';
import type { Agent, Bus, DeptId } from './types';

export const WORKSPACE = P.WORKSPACE;
const byId = Object.fromEntries(AGENTS.map((a) => [a.id, a])) as Record<string, Agent>;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Owner = 'design' | 'frontend' | 'backend' | 'devops';
const OWNERS: Owner[] = ['design', 'frontend', 'backend', 'devops'];

interface Task { owner: Owner; title: string; details: string; files?: string[] }
interface Plan { summary: string; contract: string; tasks: Task[]; focus?: string[] }
interface OutFile { path: string; content: string }
interface EditBlock { search: string; replace: string }
interface OutEdit { path: string; blocks: EditBlock[] }
type Kind = 'meeting' | 'minutes' | 'plan' | 'dev' | 'review' | 'tests' | 'fix' | 'summary' | 'reviewpart';
interface MockInfo {
  requirement?: string; task?: Task; round?: number; agent: Agent;
  mode: P.Mode; firstFile?: string; firstContent?: string;
}

export interface RunOptions { mode: P.Mode; target?: string | null; provider?: llm.ProviderChoice; meetings?: boolean }

const EXISTING_NOTE = `
หมายเหตุสำหรับงานนี้: เป็นโปรเจกต์เดิมของลูกค้า ให้ยึดภาษา/เฟรมเวิร์ก/โครงสร้าง/สไตล์โค้ดเดิม
ข้อกำหนด "Node.js ล้วน" ด้านบนใช้กับโปรเจกต์ใหม่เท่านั้น ห้ามเพิ่ม dependency ถ้าไม่จำเป็น
แก้เฉพาะส่วนที่เกี่ยวกับงาน ห้ามจัดรูปแบบโค้ดใหม่ทั้งไฟล์ และห้ามอ่าน/เขียนไฟล์ลับ (.env, key)`;

// ---------- helpers ----------

function parseFiles(text: string): OutFile[] {
  const files: OutFile[] = [];
  const re = /=== FILE: (.+?) ===\r?\n([\s\S]*?)\r?\n=== END ===/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let content = m[2];
    const fence = content.match(/^```[a-zA-Z0-9]*\r?\n([\s\S]*?)\r?\n```\s*$/);
    if (fence) content = fence[1];
    files.push({ path: m[1].trim(), content });
  }
  return files;
}

function parseEdits(text: string): OutEdit[] {
  const edits: OutEdit[] = [];
  const re = /=== EDIT: (.+?) ===\r?\n([\s\S]*?)\r?\n=== END ===/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const blocks: EditBlock[] = [];
    const br = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;
    let b: RegExpExecArray | null;
    while ((b = br.exec(m[2]))) blocks.push({ search: b[1], replace: b[2] });
    edits.push({ path: m[1].trim(), blocks });
  }
  return edits;
}

function parseJSON<T>(text: string): T {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('PM ไม่ได้ส่ง JSON กลับมา');
  return JSON.parse(text.slice(start, end + 1)) as T;
}

function safeJoin(base: string, rel: string): string | null {
  const norm = path.normalize(rel).replace(/^([/\\])+/, '');
  if (norm.startsWith('..') || path.isAbsolute(norm)) return null;
  return path.join(base, norm);
}

function filesContext(runDir: string, limitEach = 6000, limitTotal = 45000): string {
  let out = '';
  for (const f of P.listFiles(runDir)) {
    let body = fs.readFileSync(path.join(runDir, f.path), 'utf8');
    if (body.length > limitEach) body = body.slice(0, limitEach) + '\n...(ตัดทอน)';
    if (out.length + body.length < limitTotal) out += `\n--- ${f.path} ---\n${body}\n`;
  }
  return out || '(ยังไม่มีไฟล์)';
}

function selectedFiles(runDir: string, paths: string[], limitEach = 12000, limitTotal = 45000): string {
  let out = '';
  for (const rel of [...new Set(paths)]) {
    const body = P.readText(runDir, rel, limitEach);
    if (body === null) { out += `\n--- ${rel} --- (ยังไม่มีไฟล์นี้ — สร้างใหม่ได้)\n`; continue; }
    if (out.length + body.length < limitTotal) out += `\n--- ${rel} ---\n${body}\n`;
  }
  return out || '(ไม่มีไฟล์ที่ระบุ)';
}

function keyFiles(runDir: string): string {
  const names = ['package.json', 'README.md', 'pyproject.toml', 'requirements.txt', 'composer.json', 'go.mod', 'pom.xml', 'Cargo.toml'];
  return names.map((n) => { const b = P.readText(runDir, n, 2500); return b ? `--- ${n} ---\n${b}` : ''; }).filter(Boolean).join('\n') || '(ไม่พบไฟล์ตั้งค่าหลัก)';
}

/** ใช้บล็อก SEARCH/REPLACE กับเนื้อไฟล์ — ข้อความต้องตรงและพบได้ที่เดียว */
function applyBlocks(content: string, blocks: EditBlock[]): { content: string; failures: string[] } {
  const failures: string[] = [];
  let cur = content;
  blocks.forEach((b, i) => {
    const count = b.search ? cur.split(b.search).length - 1 : 0;
    if (count === 1) cur = cur.replace(b.search, () => b.replace);
    else failures.push(`บล็อกที่ ${i + 1}: ${count === 0 ? 'ไม่พบข้อความ SEARCH ในไฟล์ (ต้องตรงทุกตัวอักษรรวมช่องว่าง)' : `พบข้อความ SEARCH ${count} ที่ (ต้องเจาะจงให้เหลือที่เดียว)`}`);
  });
  return { content: cur, failures };
}

// ---------- โหมดจำลอง (ไม่เรียก AI จริง) ----------

const fileBlock = (p: string, c: string) => `=== FILE: ${p} ===\n${c}\n=== END ===`;

function mockReply(kind: Kind, info: MockInfo): string {
  const modify = info.mode === 'modify';
  switch (kind) {
    case 'plan':
      if (info.mode === 'review')
        return JSON.stringify({ summary: 'จำลองการรีวิวโปรเจกต์', focus: info.firstFile ? [info.firstFile] : [] });
      if (modify)
        return JSON.stringify({
          summary: `จำลองการแก้โปรเจกต์เดิม: ${(info.requirement ?? '').slice(0, 60)}`,
          contract: 'แก้เฉพาะไฟล์ที่เกี่ยวข้อง ใช้สไตล์โค้ดเดิม',
          tasks: [
            { owner: 'backend', title: 'แก้ไฟล์หลักตามโจทย์', details: 'เพิ่มโค้ดตัวอย่าง', files: info.firstFile ? [info.firstFile] : [] },
            { owner: 'devops', title: 'บันทึกสิ่งที่เปลี่ยน', details: 'เพิ่มไฟล์ CHANGES', files: [] },
          ],
        });
      return JSON.stringify({
        summary: `จำลองการทำ: ${(info.requirement ?? '').slice(0, 60)}`,
        contract: 'server.js เสิร์ฟ public/ และ GET /api/health ; public/index.html เรียก /api/health',
        tasks: [
          { owner: 'design', title: 'สไตล์ไกด์และ CSS หลัก', details: 'สี ฟอนต์ layout มือถือ' },
          { owner: 'frontend', title: 'หน้าเว็บหลัก', details: 'index.html + app.js' },
          { owner: 'backend', title: 'เซิร์ฟเวอร์และ API', details: 'server.js /api/health' },
          { owner: 'devops', title: 'Dockerfile และ README', details: 'รันคำสั่งเดียว' },
        ],
      });
    case 'dev': {
      const title = info.task?.title ?? '';
      if (modify) {
        if (info.agent.id === 'be1' && info.firstFile)
          return fileBlock(info.firstFile, `${info.firstContent ?? ''}\n// [AI Office โหมดจำลอง] ตัวอย่างการแก้ไข: ${title}\n`) + `\nNOTE: แก้ ${info.firstFile}`;
        return fileBlock('CHANGES_BY_AI_OFFICE.md', `# บันทึกการเปลี่ยนแปลง (โหมดจำลอง)\n\n- ${title}\n`) + '\nNOTE: เพิ่มบันทึก';
      }
      const map: Record<string, [string, string][]> = {
        ds: [['public/style.css', `/* ${title} — โดย ${info.agent.name} */\n:root{--brand:#5aa9e6}\nbody{font-family:system-ui;margin:2rem}\n`]],
        fe1: [['public/index.html', `<!doctype html><meta charset=utf-8><link rel=stylesheet href=style.css><h1>Hello from AI Office</h1><p id=s></p><script>fetch('/api/health').then(r=>r.json()).then(j=>s.textContent=j.status)</script>\n`]],
        fe2: [['public/app.js', `// ${title}\n`]],
        be1: [['server.js', `const http=require('http');http.createServer((q,r)=>{if(q.url==='/api/health'){r.setHeader('content-type','application/json');return r.end('{"status":"ok"}')}r.end('hi')}).listen(3000)\n`]],
        be2: [['lib/util.js', `// ${title}\nmodule.exports={}\n`]],
        ops: [['README.md', `# โปรเจกต์ตัวอย่าง (โหมดจำลอง)\n\nรัน: node server.js\n`], ['Dockerfile', 'FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nCMD ["node","server.js"]\n']],
      };
      const list = map[info.agent.id] ?? [[`notes/${info.agent.id}.txt`, title + '\n']];
      return list.map(([p, c]) => fileBlock(p, c)).join('\n') + `\nNOTE: เสร็จแล้ว (${title})`;
    }
    case 'review':
      if (info.agent.id === 'sec') return 'VERDICT: PASS';
      return info.round === 0 && !modify
        ? 'VERDICT: FAIL\n- [be] server.js: ไม่มี CORS/Content-Length และ 404 handler\n- [fe] public/index.html: ไม่มี error handling เมื่อ fetch ล้มเหลว'
        : 'VERDICT: PASS';
    case 'tests':
      return fileBlock('test/smoke.test.js', "const test=require('node:test');const assert=require('node:assert');\ntest('placeholder smoke test',()=>assert.ok(true));");
    case 'fix':
      return info.agent.id === 'be1'
        ? fileBlock('server.js', `const http=require('http');http.createServer((q,r)=>{if(q.url==='/api/health'){r.setHeader('content-type','application/json');return r.end('{"status":"ok"}')}r.statusCode=404;r.end('not found')}).listen(3000)`) + '\nNOTE: เพิ่ม 404'
        : fileBlock('public/index.html', `<!doctype html><meta charset=utf-8><link rel=stylesheet href=style.css><h1>Hello from AI Office</h1><p id=s></p><script>fetch('/api/health').then(r=>r.json()).then(j=>s.textContent=j.status).catch(()=>s.textContent='error')</script>`) + '\nNOTE: เพิ่ม catch';
    case 'meeting':
      return `- (${info.agent.name}) ตกลงยึด contract ที่ PM วางไว้ และจะแจ้งทีมถ้าต้องเปลี่ยน (โหมดจำลอง)`;
    case 'minutes':
      return '- ทุกคนยึด contract เดิม\n- แจ้งในทีมทันทีถ้าต้องเปลี่ยน API/โครงไฟล์\n- QA ตรวจ error handling และความปลอดภัยเป็นพิเศษ (โหมดจำลอง)';
    case 'reviewpart':
      return `## ข้อสังเกตจาก ${info.agent.name} (โหมดจำลอง)\n\n- โครงสร้างโปรเจกต์อ่านง่าย\n- ควรเพิ่มเทสต์และจัดการ error ให้ครบ\n- ตรวจ input จากผู้ใช้ทุกจุด`;
    case 'summary':
      return info.mode === 'review'
        ? 'รีวิวเสร็จแล้วค่ะ (โหมดจำลอง) ทีมสรุปข้อสังเกตไว้ในไฟล์ REVIEW.md'
        : modify
          ? 'แก้โปรเจกต์เสร็จแล้วค่ะ (โหมดจำลอง) ไฟล์ที่เปลี่ยนรอให้คุณตรวจ diff และกด "นำไปใช้" ด้านล่าง'
          : 'งานเสร็จแล้วค่ะ (โหมดจำลอง) ทีมส่งมอบโค้ดตัวอย่างครบทุกแผนก ผ่านการรีวิวและแก้ไขแล้ว ไฟล์อยู่ในรายการด้านข้าง';
  }
}

// ---------- ตัวควบคุมหลัก ----------

export async function runTask(requirement: string, bus: Bus, opts: RunOptions = { mode: 'new' }): Promise<void> {
  const mode = opts.mode;
  const meetingsOn = opts.meetings === true; // เปิดประชุมจริง (ใช้ AI เพิ่ม) — ค่าเริ่มต้นปิด
  const provider: llm.ProviderChoice = opts.provider ?? llm.defaultProvider();
  const existing = mode !== 'new';
  const isModify = mode === 'modify';
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = path.join(WORKSPACE, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const manifest: P.Manifest = {
    runId, mode, target: opts.target ?? null, createdAt: new Date().toISOString(), touched: [], base: {},
  };
  P.writeManifest(manifest);

  const { state, log, handoff, meeting, file, run } = bus;
  const rr: Partial<Record<DeptId, number>> = {};

  const pick = (dept: DeptId): Agent => {
    const list = AGENTS.filter((a) => a.dept === dept);
    rr[dept] = (rr[dept] ?? 0) + 1;
    return list[(rr[dept]! - 1) % list.length];
  };

  const mockCtx = () => {
    const first = P.listFiles(runDir).find((f) => f.size > 0 && f.size < 10000 && !/\.(md|json|lock)$/i.test(f.path)) ?? P.listFiles(runDir)[0];
    return { firstFile: first?.path, firstContent: first ? fs.readFileSync(path.join(runDir, first.path), 'utf8') : '' };
  };

  async function think(agent: Agent, text: string, kind: Kind, prompt: string, info: Partial<MockInfo> = {}, maxTokens?: number): Promise<string> {
    state(agent.id, 'working', text);
    try {
      if (provider === 'mock') {
        await sleep(2500 + Math.random() * 2500);
        return mockReply(kind, { ...info, agent, mode, requirement, ...(existing ? mockCtx() : {}) });
      }
      return await llm.ask(provider, existing ? agent.system + EXISTING_NOTE : agent.system, prompt, maxTokens);
    } finally {
      state(agent.id, 'idle', '');
    }
  }

  /** เขียนไฟล์ลงสำเนา + บันทึกว่าแตะไฟล์ไหน (ใช้ตรวจ diff/นำไปใช้ภายหลัง) */
  function writeTouched(agent: Agent, rel: string, content: string): boolean {
    const dest = safeJoin(runDir, rel);
    if (!dest) { log(agent.id, `ข้ามไฟล์ที่ path ไม่ปลอดภัย: ${rel}`, 'warn'); return false; }
    if (/(^|\/)\.env(\.|$)|(^|\/)\.git\//.test(rel.replace(/\\/g, '/'))) { log(agent.id, `ข้ามไฟล์ที่ห้ามแตะ: ${rel}`, 'warn'); return false; }
    P.markTouched(manifest, path.relative(runDir, dest).split(path.sep).join('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    file(runId, rel, agent.id);
    return true;
  }

  function saveOutputs(agent: Agent, text: string): { n: number; failures: string[] } {
    let n = 0;
    const failures: string[] = [];
    for (const f of parseFiles(text)) if (writeTouched(agent, f.path, f.content)) n++;
    for (const e of parseEdits(text)) {
      const full = safeJoin(runDir, e.path);
      const cur = full && fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
      if (cur === null) { failures.push(`${e.path}: ไม่พบไฟล์นี้ (ถ้าสร้างไฟล์ใหม่ให้ใช้บล็อก FILE)`); continue; }
      const r = applyBlocks(cur, e.blocks);
      r.failures.forEach((f) => failures.push(`${e.path} · ${f}`));
      if (r.content !== cur && writeTouched(agent, e.path, r.content)) n++;
    }
    return { n, failures };
  }

  const planFiles = (p: Plan) => (p.tasks ?? []).flatMap((t) => t.files ?? []);

  async function devJob(agent: Agent, task: Task, plan: Plan): Promise<number> {
    let prompt: string;
    if (isModify) {
      prompt = `โจทย์ลูกค้า:\n${requirement}\n\nแผนรวม: ${plan.summary}\nแนวทาง/ข้อควรระวัง:\n${plan.contract}\n\nโครงสร้างโปรเจกต์เดิม:\n${P.treeText(runDir, 150)}\n\nงานของคุณ: ${task.title}\nรายละเอียด: ${task.details}\n\nเนื้อหาไฟล์ที่เกี่ยวข้อง:\n${selectedFiles(runDir, task.files ?? [])}\n\n${EDIT_FORMAT}`;
    } else {
      prompt = `โจทย์ลูกค้า:\n${requirement}\n\nแผนรวม: ${plan.summary}\nContract (โครงไฟล์/API ที่ทุกคนต้องยึดตรงกัน):\n${plan.contract}\n\nงานของคุณ: ${task.title}\nรายละเอียด: ${task.details}\n\nไฟล์ที่ทีมทำไว้แล้ว:\n${filesContext(runDir)}\n\nส่งมอบเฉพาะไฟล์ที่คุณรับผิดชอบ ในรูปแบบนี้ (เขียนเนื้อไฟล์ครบทั้งไฟล์):\n=== FILE: path/relative/file.ext ===\n(เนื้อไฟล์)\n=== END ===\nห้ามมีข้อความอื่นนอกบล็อกไฟล์ ยกเว้นบรรทัดสุดท้ายที่ขึ้นต้นด้วย "NOTE:" สรุปสั้น ๆ เป็นภาษาไทย`;
    }
    const out = await think(agent, `${isModify ? 'แก้' : 'เขียน'}: ${task.title}`, 'dev', prompt, { task });
    let { n, failures } = saveOutputs(agent, out);

    if (failures.length) { // ลองใหม่ 1 ครั้ง โดยส่งเนื้อไฟล์ปัจจุบันให้ดู
      log(agent.id, `แก้บางจุดไม่สำเร็จ ลองใหม่: ${failures.join(' | ')}`, 'warn');
      const paths = [...new Set(failures.map((f) => f.split(':')[0].split(' · ')[0]))];
      const retry = await think(agent, `แก้ใหม่: ${task.title}`, 'dev',
        `การแก้ครั้งก่อนมีปัญหา:\n${failures.join('\n')}\n\nเนื้อหาไฟล์ปัจจุบัน:\n${selectedFiles(runDir, paths)}\n\nส่งการแก้ที่ถูกต้องอีกครั้ง เฉพาะส่วนที่ยังไม่สำเร็จ\n\n${EDIT_FORMAT}`, { task });
      const r2 = saveOutputs(agent, retry);
      n += r2.n;
      if (r2.failures.length) log(agent.id, `ยังแก้ไม่สำเร็จ: ${r2.failures.join(' | ')}`, 'error');
    }
    const note = out.match(/NOTE:\s*(.+)/)?.[1] ?? `ส่งมอบ ${n} ไฟล์`;
    log(agent.id, `${task.title} → ${n} ไฟล์ · ${note}`);
    return n;
  }

  async function dispatchStage(tasks: Task[], plan: Plan): Promise<void> {
    const queues = new Map<string, Promise<unknown>>();
    const jobs: Promise<unknown>[] = [];
    for (const task of tasks) {
      const agent = pick(task.owner);
      await handoff('pm', agent.id, task.title);
      const p = (queues.get(agent.id) ?? Promise.resolve()).then(() => devJob(agent, task, plan));
      queues.set(agent.id, p);
      jobs.push(p);
    }
    await Promise.all(jobs);
  }

  /** บริบทสำหรับ QA ในโหมดแก้ของเดิม: diff + เนื้อไฟล์ที่ถูกแก้ (ไม่ส่งทั้งโปรเจกต์) */
  function changeContext(): string {
    const changes = P.computeChanges(manifest);
    const diffs = changes.map((c) => `### ${c.status === 'added' ? 'ไฟล์ใหม่' : 'แก้ไข'}: ${c.path}\n${c.diff.slice(0, 6000)}`).join('\n\n');
    return `${diffs || '(ยังไม่มีการเปลี่ยนแปลง)'}\n\nเนื้อหาไฟล์หลังแก้:\n${selectedFiles(runDir, manifest.touched, 8000, 30000)}`;
  }

  const pm = byId.pm, qa1 = byId.qa1, qa2 = byId.qa2, sec = byId.sec;

  try {
    run({ status: 'start', id: runId, requirement, mode, target: manifest.target });

    if (existing) {
      if (!manifest.target) throw new Error('ไม่ได้ระบุโปรเจกต์');
      const r = P.copyProject(manifest.target, runDir);
      log('pm', `คัดลอกโปรเจกต์มาทำงานบนสำเนา: ${r.files} ไฟล์ (ข้าม ${r.skipped} ไฟล์ที่เป็นไบนารี/ไฟล์ลับ/ไฟล์ใหญ่) — ไฟล์จริงจะไม่ถูกแตะจนกว่าคุณจะอนุมัติ`, 'sys');
      if (r.files === 0 && isModify) throw new Error('ไม่พบไฟล์ข้อความในโฟลเดอร์นี้ที่ AI อ่านได้');
    }

    // ============ โหมดรีวิว ============
    if (mode === 'review') {
      const planPrompt = `ลูกค้าอยากให้รีวิว/อธิบายโปรเจกต์นี้ (ไม่ต้องแก้ไฟล์)\nโจทย์: ${requirement}\n\nโครงสร้างโปรเจกต์:\n${P.treeText(runDir)}\n\nไฟล์สำคัญ:\n${keyFiles(runDir)}\n\nเลือกไฟล์ที่ควรอ่านเพื่อตอบโจทย์ (ไม่เกิน 12 ไฟล์ เลือกจากรายการข้างบนเท่านั้น)\nตอบ JSON อย่างเดียว: {"summary":"สรุปว่าโปรเจกต์นี้คืออะไร 1-2 ประโยค","focus":["path/file1","path/file2"]}`;
      const plan = parseJSON<Plan>(await think(pm, 'อ่านโครงสร้างโปรเจกต์', 'plan', planPrompt));
      const focus = (plan.focus ?? []).filter((f) => P.readText(runDir, f, 1) !== null).slice(0, 12);
      log('pm', `โปรเจกต์: ${plan.summary} · เลือกอ่าน ${focus.length} ไฟล์`);
      const code = selectedFiles(runDir, focus, 10000, 50000);

      const reviewers = [
        { agent: qa1, lens: 'คุณภาพโค้ด บั๊กที่เป็นไปได้ และจุดเสี่ยง' },
        { agent: byId.be1, lens: 'สถาปัตยกรรม logic ฝั่งเซิร์ฟเวอร์ และการจัดการข้อมูล' },
        { agent: sec, lens: 'ความปลอดภัย (OWASP, secret หลุด, input validation, auth, dependency เสี่ยง)' },
        { agent: byId.fe1, lens: 'ฝั่งหน้าบ้าน UI/UX ประสิทธิภาพ และความอ่านง่ายของโค้ด' },
      ];
      const jobs: Promise<string>[] = [];
      for (const r of reviewers) {
        await handoff('pm', r.agent.id, `ช่วยดู: ${r.lens.slice(0, 20)}…`);
        jobs.push((async () => {
          const out = await think(r.agent, 'อ่านและรีวิวโค้ด', 'reviewpart',
            `โจทย์ลูกค้า: ${requirement}\nสรุปโปรเจกต์: ${plan.summary}\n\nไฟล์:\n${code}\n\nรีวิวในมุม: ${r.lens}\nตอบเป็น Markdown ภาษาไทย สั้นและเจาะจง อ้างชื่อไฟล์/ฟังก์ชัน มีหัวข้อ "ข้อดี", "ปัญหาที่พบ", "ข้อเสนอแนะ" (ไม่ต้องเขียนโค้ดแก้ใหม่ทั้งไฟล์)`);
          const rel = `review/${r.agent.name.toLowerCase()}.md`;
          fs.mkdirSync(path.join(runDir, 'review'), { recursive: true });
          fs.writeFileSync(path.join(runDir, rel), out);
          file(runId, rel, r.agent.id);
          log(r.agent.id, `รีวิวเสร็จ → ${rel}`);
          return `# ${r.agent.name} (${r.lens})\n${out}`;
        })());
      }
      const parts = await Promise.all(jobs);
      await handoff('qa1', 'pm', 'รีวิวเสร็จแล้ว');
      const summary = (await think(pm, 'สรุปผลรีวิว', 'summary',
        `โจทย์ลูกค้า: ${requirement}\n\nผลรีวิวจากทีม:\n${parts.join('\n\n')}\n\nสรุปเป็นรายงานภาษาไทยที่อ่านง่าย: ภาพรวมโปรเจกต์ → ข้อดี → ปัญหาเรียงตามความสำคัญ → สิ่งที่ควรทำต่อ (ตอบโจทย์ลูกค้าให้ตรงประเด็น)`)).trim();
      fs.writeFileSync(path.join(runDir, 'REVIEW.md'), `# รายงานรีวิว\n\n**โจทย์:** ${requirement}\n\n${summary}\n\n---\n\n${parts.join('\n\n')}\n`);
      file(runId, 'REVIEW.md', 'pm');
      log('pm', summary, 'ok');
      run({ status: 'done', id: runId, summary, mode, target: manifest.target, applyable: false });
      return;
    }

    // ============ โหมดสร้างใหม่ / แก้ของเดิม ============
    let planPrompt: string;
    if (isModify) {
      planPrompt = `โจทย์ลูกค้า (แก้ไข/เพิ่มฟีเจอร์ในโปรเจกต์เดิม):\n${requirement}\n\nโครงสร้างโปรเจกต์เดิม:\n${P.treeText(runDir)}\n\nไฟล์สำคัญ:\n${keyFiles(runDir)}

วางแผนการแก้ โดยแก้ให้น้อยที่สุดเท่าที่จำเป็น และยึดสไตล์เดิมของโปรเจกต์
ตอบเป็น JSON อย่างเดียว ไม่มีข้อความอื่น รูปแบบ:
{"summary":"สรุปสิ่งที่จะทำ 1-2 ประโยค","contract":"แนวทางแก้ ข้อควรระวัง และ convention ของโปรเจกต์ที่ทุกคนต้องยึด","tasks":[{"owner":"design|frontend|backend|devops","title":"ชื่องาน","details":"รายละเอียดที่ต้องทำ","files":["path ที่ต้องอ่าน/แก้ (เลือกจากโครงสร้างข้างบน หรือเป็นไฟล์ใหม่ที่จะสร้าง)"]}]}
ข้อกำหนด: tasks 1-5 งาน, owner ใช้ได้เฉพาะ design, frontend, backend, devops (เลือกเฉพาะแผนกที่จำเป็นจริง), files ของแต่ละงานไม่เกิน 6 ไฟล์`;
    } else {
      planPrompt = `โจทย์ลูกค้า:\n${requirement}\n\nแตกงานให้ทีม โดยโปรเจกต์ต้องเป็นแอปเล็กที่รันได้จริงโดยไม่ต้องติดตั้ง library (Node.js http ล้วน + HTML/CSS/JS ล้วน)
ตอบเป็น JSON อย่างเดียว ไม่มีข้อความอื่น รูปแบบ:
{"summary":"สรุปโจทย์ 1-2 ประโยค","contract":"โครงไฟล์ทั้งโปรเจกต์ และ API endpoints (method, path, request, response) ให้ละเอียดพอที่ frontend/backend เขียนแยกกันแล้วต่อกันได้","tasks":[{"owner":"design|frontend|backend|devops","title":"ชื่องาน","details":"รายละเอียดที่ต้องทำ"}]}
ข้อกำหนด: tasks 3-6 งาน, owner ใช้ได้เฉพาะ design, frontend, backend, devops, ควรมี frontend และ backend อย่างน้อยอย่างละ 1 งาน`;
    }
    const plan = parseJSON<Plan>(await think(pm, 'วิเคราะห์โจทย์และแตกงาน', 'plan', planPrompt, { requirement }));
    plan.tasks = (plan.tasks ?? []).filter((t) => OWNERS.includes(t.owner));
    if (!plan.tasks.length) throw new Error('PM ไม่ได้แตกงานให้ใคร ลองเขียนโจทย์ให้ละเอียดขึ้น');
    log('pm', `แผน: ${plan.summary} (${plan.tasks.length} งาน)`);
    if (isModify) log('pm', `ไฟล์ที่เกี่ยวข้อง: ${[...new Set(planFiles(plan))].join(', ') || '(ไม่ระบุ)'}`, 'sys');

    const stage = (owners: Owner[]) => plan.tasks.filter((t) => owners.includes(t.owner));
    // ประชุมเปิดงาน (เปิดสวิตช์เท่านั้น): ทุกคนเข้าห้องประชุม หัวหน้าแต่ละฝ่ายให้ความเห็นต่อแผน แล้ว PM สรุปมติ — มติถูกเพิ่มเข้า contract ที่ทุกคนต้องยึด
    if (meetingsOn) {
      const owners = new Set(plan.tasks.map((t) => t.owner));
      const speakers = [owners.has('design') && 'ds', 'fe1', 'be1', owners.has('devops') && 'ops', 'qa1', 'sec'].filter((x): x is string => !!x).map((id) => byId[id]);
      const planText = `โจทย์ลูกค้า: ${requirement}\nแผน: ${plan.summary}\nContract:\n${plan.contract}\nงาน:\n${plan.tasks.map((t) => `- [${t.owner}] ${t.title}: ${t.details}`).join('\n')}`;
      const minutes = await meeting('pm', ['ds', 'fe1', 'fe2', 'be1', 'be2', 'ops', 'qa1', 'qa2', 'sec'], `ประชุมเปิดงาน: ${plan.summary ?? requirement}`.slice(0, 80), async () => {
        const opinions = await Promise.all(speakers.map(async (a) => `${a.name} (${a.title}): ${(await think(a, 'ให้ความเห็นในที่ประชุม', 'meeting', `${planText}\n\nคุณอยู่ในที่ประชุมเปิดงาน ให้ความเห็นสั้น ๆ (ไม่เกิน 4 ข้อ ข้อละบรรทัด ขึ้นต้นด้วย "- ") ต่อแผนนี้ในมุมงานของคุณ: ความเสี่ยง ข้อควรระวัง หรือจุดที่ contract ยังไม่ชัด ถ้าไม่มีข้อกังวลให้ตอบ "- ไม่มีข้อกังวล"`, {}, 700)).trim()}`));
        for (let k = 0; k < speakers.length; k++) log(speakers[k].id, opinions[k].split('\n').slice(1).join(' ') || opinions[k]);
        return (await think(pm, 'สรุปมติที่ประชุม', 'minutes', `${planText}\n\nความเห็นจากที่ประชุม:\n${opinions.join('\n\n')}\n\nสรุปมติที่ประชุมเป็นข้อ ๆ (ไม่เกิน 8 ข้อ ขึ้นต้นด้วย "- ") เฉพาะสิ่งที่ทีมต้องทำตามจริง ๆ (เช่น ข้อตกลงเรื่อง API/โครงไฟล์ ข้อควรระวัง) ห้ามเปลี่ยนโจทย์ลูกค้า`, {}, 900)).trim();
      });
      if (minutes) {
        plan.contract = `${plan.contract}\n\nมติที่ประชุมเปิดงาน (ทุกคนต้องยึดตาม):\n${minutes}`;
        log('pm', `มติที่ประชุมเปิดงาน:\n${minutes}`, 'ok');
      }
    }
    if (stage(['design']).length) await dispatchStage(stage(['design']), plan);
    if (stage(['frontend', 'backend']).length) await dispatchStage(stage(['frontend', 'backend']), plan);
    if (stage(['devops']).length) await dispatchStage(stage(['devops']), plan);

    // QA
    await Promise.all([
      handoff('be1', 'qa1', 'โค้ดพร้อมรีวิวแล้ว'),
      handoff('fe1', 'qa2', isModify ? 'ช่วยเช็คผลกระทบด้วย' : 'ช่วยเขียนเทสต์ให้หน่อย'),
      handoff('ops', 'sec', 'ช่วยตรวจความปลอดภัยด้วย'),
    ]);

    const verdictFmt = `บรรทัดแรกต้องเป็น "VERDICT: PASS" (ไม่มีปัญหาร้ายแรง) หรือ "VERDICT: FAIL"
ถ้า FAIL ให้ตามด้วยรายการปัญหา บรรทัดละข้อ รูปแบบ: - [fe|be] path/file: ปัญหาและวิธีแก้ (ไม่เกิน 6 ข้อ)`;

    let pass = false;
    for (let round = 0; round < 2 && !pass; round++) {
      let reviews: string[];
      if (isModify) {
        const ctx = changeContext();
        const base = `โจทย์ลูกค้า: ${requirement}\nแนวทาง: ${plan.contract}\n\nสิ่งที่ทีมแก้ (diff):\n${ctx}\n\n`;
        reviews = await Promise.all([
          think(qa1, round ? 'รีวิวรอบสอง' : 'รีวิวการแก้ไข', 'review', `${base}รีวิวว่าการแก้ตอบโจทย์ถูกต้องไหม มีบั๊ก/ข้อผิดพลาดทางตรรกะ หรือแก้เกินขอบเขตหรือไม่\n${verdictFmt}`, { round }),
          think(qa2, 'เช็คผลกระทบ/ความเสี่ยง', 'review', `${base}ตรวจผลกระทบต่อส่วนอื่นของโปรเจกต์ (regression), edge case, และ style ที่ไม่สอดคล้องกับโค้ดเดิม\n${verdictFmt}`, { round }),
          think(sec, 'ตรวจความปลอดภัย', 'review', `${base}ตรวจความปลอดภัยของโค้ดที่แก้/เพิ่ม (OWASP: injection, XSS, path traversal, auth, secret หลุด, input validation) ว่าการเปลี่ยนนี้เพิ่มช่องโหว่หรือไม่\n${verdictFmt}`, { round }),
        ]);
      } else {
        const ctx = filesContext(runDir);
        const reviewPrompt = `Contract:\n${plan.contract}\n\nโค้ดทั้งหมด:\n${ctx}\n\nรีวิวหาบั๊ก/ช่องโหว่/ความไม่ตรงกันของ frontend-backend\n${verdictFmt}`;
        const testsPrompt = `Contract:\n${plan.contract}\n\nโค้ดทั้งหมด:\n${ctx}\n\nเขียนเทสต์ด้วย node:test ที่รันด้วย "node --test" ได้ ครอบคลุม API หลักและ logic สำคัญ
ส่งมอบรูปแบบ:\n=== FILE: test/xxx.test.js ===\n(เนื้อไฟล์)\n=== END ===`;
        const secPrompt = `Contract:\n${plan.contract}\n\nโค้ดทั้งหมด:\n${ctx}\n\nตรวจความปลอดภัยตามแนว OWASP: injection, XSS, path traversal, auth/authz, secret ที่หลุดในโค้ด, input validation, การเผยข้อมูลใน error\n${verdictFmt}`;
        const [review, tests, secReview] = await Promise.all([
          think(qa1, round === 0 ? 'รีวิวโค้ดทั้งโปรเจกต์' : 'รีวิวรอบสอง', 'review', reviewPrompt, { round }),
          round === 0 ? think(qa2, 'เขียนเทสต์อัตโนมัติ', 'tests', testsPrompt) : Promise.resolve(''),
          think(sec, 'ตรวจความปลอดภัย', 'review', secPrompt, { round }),
        ]);
        if (tests) log('qa2', `เขียนเทสต์ ${saveOutputs(qa2, tests).n} ไฟล์`);
        reviews = [review, secReview];
      }

      pass = reviews.every((r) => /VERDICT:\s*PASS/i.test(r));
      const issues = reviews.flatMap((r) => r.split('\n').filter((l) => l.trim().startsWith('-')));
      log('qa1', pass ? 'ผ่านการรีวิว ✅' : `พบปัญหา:\n${issues.join('\n') || reviews.join('\n')}`, pass ? 'ok' : 'warn');
      if (pass || round === 1) break;

      const targets = ([{ agent: byId.be1, tag: 'be' }, { agent: byId.fe1, tag: 'fe' }] as const)
        .map((t) => ({
          ...t,
          mine: issues.filter((l) => new RegExp(`\\[${t.tag}\\]`, 'i').test(l) || (t.tag === 'be' && !/\[(fe|be)\]/i.test(l))),
        }))
        .filter((t) => t.mine.length);
      if (!targets.length) break;

      // ประชุมแก้ปัญหา (เปิดสวิตช์เท่านั้น): คนที่ต้องแก้เสนอแนวทาง แล้ว QA สรุปแนวทางที่ตกลงกัน → ใส่ในคำสั่งแก้ของแต่ละคน
      let fixNotes = '';
      if (meetingsOn) {
        fixNotes = (await meeting('qa1', ['sec', ...targets.map((t) => t.agent.id)], `ประชุมแก้ปัญหาที่ QA พบ (${issues.length} ข้อ)`, async () => {
          const approaches = await Promise.all(targets.map(async (t) => `${t.agent.name}:\n${(await think(t.agent, 'เสนอแนวทางแก้ในที่ประชุม', 'meeting', `ปัญหาที่ QA พบในส่วนของคุณ:\n${t.mine.join('\n')}\n\nเสนอแนวทางแก้สั้น ๆ (ไม่เกิน 3 ข้อ ขึ้นต้นด้วย "- ") ยังไม่ต้องเขียนโค้ด`, {}, 600)).trim()}`));
          return (await think(qa1, 'สรุปแนวทางแก้ที่ตกลงกัน', 'minutes', `ปัญหาทั้งหมด:\n${issues.join('\n')}\n\nแนวทางที่แต่ละคนเสนอ:\n${approaches.join('\n\n')}\n\nสรุปแนวทางแก้ที่ตกลงกัน แยกตามชื่อคน (ไม่เกิน 6 ข้อ ขึ้นต้นด้วย "- ") ให้ตรงกับปัญหาที่พบเท่านั้น ห้ามขยายขอบเขต`, {}, 800)).trim();
        })) ?? '';
        if (fixNotes) log('qa1', `มติที่ประชุมแก้ปัญหา:\n${fixNotes}`, 'ok');
      }
      await Promise.all(targets.map((t) => handoff('qa1', t.agent.id, `มี ${t.mine.length} ข้อต้องแก้`)));
      await Promise.all(targets.map(async (t) => {
        const cur = isModify
          ? `${changeContext()}\n\n${EDIT_FORMAT}`
          : `โค้ดปัจจุบัน:\n${filesContext(runDir)}\n\nแก้ไขแล้วส่งเฉพาะไฟล์ที่เปลี่ยน (เนื้อไฟล์ครบทั้งไฟล์) รูปแบบ:\n=== FILE: path ===\n...\n=== END ===\nบรรทัดสุดท้าย "NOTE: ..." สรุปสิ่งที่แก้`;
        const out = await think(t.agent, 'แก้ตามที่ QA แจ้ง', 'fix', `ปัญหาที่ QA พบในส่วนของคุณ:\n${t.mine.join('\n')}${fixNotes ? `\n\nมติที่ประชุมแก้ปัญหา (แนวทางที่ตกลงกัน):\n${fixNotes}` : ''}\n\n${cur}`);
        const r = saveOutputs(t.agent, out);
        if (r.failures.length) log(t.agent.id, `แก้บางจุดไม่สำเร็จ: ${r.failures.join(' | ')}`, 'warn');
        log(t.agent.id, `แก้แล้ว ${r.n} ไฟล์ · ${out.match(/NOTE:\s*(.+)/)?.[1] ?? ''}`);
      }));
      await handoff('be1', 'qa1', 'แก้แล้ว ช่วยดูอีกรอบ');
    }

    // PM สรุป
    await handoff('qa1', 'pm', pass ? 'ผ่านครบแล้ว' : 'รีวิวเสร็จ มีข้อสังเกตเหลือ');
    const applyable = !!manifest.target && manifest.touched.length > 0;
    const ctxForSummary = isModify ? changeContext().slice(0, 8000) : filesContext(runDir, 800, 8000);
    const summaryPrompt = `โจทย์: ${requirement}\nแผน: ${plan.summary}\n${isModify ? 'การเปลี่ยนแปลง' : 'ไฟล์ทั้งหมด'}:\n${ctxForSummary}\n\nสรุปผลงานให้ลูกค้าเป็นภาษาไทย 3-5 ประโยค ${isModify ? 'บอกว่าแก้ไฟล์ไหนอย่างไร และเตือนให้ตรวจ diff ก่อนกด "นำไปใช้" (ไฟล์เดิมจะถูกสำรองไว้ให้)' : 'พร้อมวิธีรันโปรเจกต์ (คำสั่งเดียว)'} และข้อควรระวัง ถ้า QA ยังพบปัญหาค้างให้บอกตรง ๆ`;
    const summary = (await think(pm, 'สรุปงานส่งลูกค้า', 'summary', summaryPrompt)).trim();
    log('pm', summary, 'ok');
    run({ status: 'done', id: runId, summary, mode, target: manifest.target, applyable });
  } catch (err) {
    console.error(err);
    for (const a of AGENTS) state(a.id, 'idle', '');
    const message = err instanceof Error ? err.message : String(err);
    log('pm', `เกิดข้อผิดพลาด: ${message}`, 'error');
    run({ status: 'error', id: runId, error: message, mode });
  }
}

const EDIT_FORMAT = `ส่งมอบการแก้ในรูปแบบนี้ (ใช้ได้หลายบล็อก):

แก้ไฟล์ที่มีอยู่ — ใช้ SEARCH/REPLACE (SEARCH ต้องคัดลอกจากไฟล์ให้ตรงทุกตัวอักษรรวมช่องว่าง และต้องพบได้ที่เดียวในไฟล์ ให้เลือกหลายบรรทัดพอที่จะเจาะจง):
=== EDIT: path/relative/file.ext ===
<<<<<<< SEARCH
(ข้อความเดิมที่จะแทนที่)
=======
(ข้อความใหม่)
>>>>>>> REPLACE
=== END ===

สร้างไฟล์ใหม่ (หรือเขียนทับทั้งไฟล์เมื่อแก้มากจริง ๆ) — ใช้ FILE เขียนเนื้อไฟล์ครบทั้งไฟล์:
=== FILE: path/relative/new-file.ext ===
(เนื้อไฟล์)
=== END ===

ห้ามมีข้อความอื่นนอกบล็อก ยกเว้นบรรทัดสุดท้ายที่ขึ้นต้นด้วย "NOTE:" สรุปสั้น ๆ เป็นภาษาไทย`;
