'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeptId, DeptInfo, LogLevel, PublicAgent, ServerEvent } from '@/lib/types';
import type { ProviderChoice, ProviderInfo } from '@/lib/llm';
import ChangesPanel from './ChangesPanel';
import FolderPicker from './FolderPicker';
import ProviderSelect from './ProviderSelect';
import OfficeScene, { type Flight, type Meeting } from './OfficeScene';
import { LogPanel, TeamPanel, type AgentStates, type FileItem, type LogItem } from './Sidebar';

type Mode = 'new' | 'modify' | 'review';
type ThemeId = 'navy' | 'graphite' | 'light' | 'mint';
const THEMES: { id: ThemeId; label: string; a: string; b: string }[] = [
  { id: 'navy', label: 'กรมท่า', a: '#140E50', b: '#5B49E0' },
  { id: 'graphite', label: 'กราไฟต์', a: '#0E1014', b: '#4F5FE0' },
  { id: 'light', label: 'สว่าง', a: '#F3F3F8', b: '#4338CA' },
  { id: 'mint', label: 'มิ้นต์', a: '#0B1F1E', b: '#0F766E' },
];
const fmtTime = (t?: number) => new Date(t ?? Date.now()).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });


const MODES: { id: Mode; label: string; hint: string; placeholder: string }[] = [
  { id: 'new', label: '✨ สร้างใหม่', hint: 'สร้างโปรเจกต์ใหม่ — ดาวน์โหลดเป็น .zip หรือบันทึกลงโฟลเดอร์ที่คลิกเลือก',
    placeholder: 'สั่งงานบริษัท เช่น: ทำเว็บจดบันทึกงาน (to-do) มีระบบเพิ่ม/ลบ/ติ๊กเสร็จ เก็บข้อมูลในไฟล์ JSON' },
  { id: 'modify', label: '🛠 แก้โปรเจกต์เดิม', hint: 'แก้บั๊ก/เพิ่มฟีเจอร์ — AI ทำบนสำเนา แล้วคุณตรวจ diff และกดอนุมัติ',
    placeholder: 'บอกสิ่งที่ต้องการ เช่น: แก้บั๊กที่กดลบแล้วรายการไม่หาย / เพิ่มช่องค้นหาในหน้ารายการ' },
  { id: 'review', label: '🔍 รีวิวอย่างเดียว', hint: 'อ่านและรีวิว/อธิบายโค้ด ไม่แก้ไฟล์',
    placeholder: 'ถามได้เลย เช่น: โปรเจกต์นี้ทำงานยังไง / ช่วยหาช่องโหว่ความปลอดภัย' },
];


export interface InitialOffice {
  roster: PublicAgent[];
  depts: Record<DeptId, DeptInfo>;
  providers: ProviderInfo[];
  defaultProvider: ProviderChoice;
  projectsRoot: string | null;
}

export default function OfficeApp({ initial }: { initial: InitialOffice }) {
  const logId = useRef(0);
  const flightKey = useRef(0);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [meeting, setMeeting] = useState<Meeting | null>(null);

  const [roster, setRoster] = useState<PublicAgent[]>(initial.roster);
  const [depts, setDepts] = useState<Record<DeptId, DeptInfo> | null>(initial.depts);
  const [states, setStates] = useState<AgentStates>(() => Object.fromEntries(initial.roster.map((a) => [a.id, { state: 'idle' as const, text: '' }])));
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>(initial.providers);
  const [meetings, setMeetings] = useState(false); // ประชุมจริง (ใช้ AI เพิ่ม) — ค่าเริ่มต้นปิด
  const [provider, setProvider] = useState<ProviderChoice>(initial.defaultProvider);
  const [conn, setConn] = useState(false);
  const [text, setText] = useState('');
  const [workMode, setWorkMode] = useState<Mode>('new');
  const [projPath, setProjPath] = useState('');
  const [projectsRoot, setProjectsRoot] = useState<string | null>(initial.projectsRoot);
  const [applyRun, setApplyRun] = useState<string | null>(null);
  const [doneRun, setDoneRun] = useState<string | null>(null);
  const [saveDir, setSaveDir] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeId>('navy');
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const worked = useRef<Set<string>>(new Set());
  const saveDirRef = useRef('');
  const pendingSave = useRef(false);
  useEffect(() => { saveDirRef.current = saveDir; }, [saveDir]);

  // จำค่าที่ผู้ใช้ตั้งไว้ข้ามการรีเฟรช (โหมด/โฟลเดอร์/ค่าย AI/ประชุม/ข้อความที่พิมพ์ค้าง)
  const savedProvider = useRef<ProviderChoice | null>(null);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const j = JSON.parse(localStorage.getItem('aiOffice.prefs') ?? '{}') as Partial<{ workMode: Mode; projPath: string; saveDir: string; provider: ProviderChoice; meetings: boolean; text: string; theme: ThemeId }>;
      if (j.workMode && MODES.some((m) => m.id === j.workMode)) setWorkMode(j.workMode);
      if (typeof j.projPath === 'string') setProjPath(j.projPath);
      if (typeof j.saveDir === 'string') setSaveDir(j.saveDir);
      if (typeof j.meetings === 'boolean') setMeetings(j.meetings);
      if (typeof j.text === 'string') setText(j.text);
      if (j.theme && THEMES.some((t) => t.id === j.theme)) setTheme(j.theme);
      if (j.provider) { savedProvider.current = j.provider; setProvider(j.provider); }
    } catch { /* ไม่มี/อ่านไม่ได้ — ใช้ค่าเริ่มต้น */ }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    savedProvider.current = provider;
    try { localStorage.setItem('aiOffice.prefs', JSON.stringify({ workMode, projPath, saveDir, provider, meetings, text, theme })); } catch { /* ignore */ }
  }, [restored, workMode, projPath, saveDir, provider, meetings, text, theme]);

  const addLog = useCallback((agent: string | null, msg: string, level: LogLevel = 'info', t?: number) => {
    setLogs((l) => [...l, { id: ++logId.current, agent, text: msg, level, time: fmtTime(t) }]);
  }, []);

  useEffect(() => {
    let nameOf = new Map<string, string>();

    const es = new EventSource('/api/events');
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data) as ServerEvent;
      switch (ev.type) {
        case 'hello':
          nameOf = new Map(ev.roster.map((a) => [a.id, a.name]));
          setProjectsRoot(ev.projectsRoot);
          setRoster(ev.roster); setDepts(ev.depts); setStates(ev.agentState);
          setLogs([]); setFiles([]); setBusy(ev.busy); worked.current = new Set(); setDoneIds(new Set());
          setConn(true);
          setProviders(ev.providers);
          // คงตัวเลือกเดิมของผู้ใช้ไว้ถ้ายังพร้อมใช้ ไม่งั้นใช้ค่าเริ่มต้นจากเซิร์ฟเวอร์
          setProvider((cur) => {
            const want = savedProvider.current ?? cur;
            return ev.providers.some((p) => p.id === want && p.ready && want !== 'mock') ? want : ev.defaultProvider;
          });
          if (!ev.busy) {
            addLog(null, 'พร้อมรับงานค่ะ', 'sys');
          }
          break;
        case 'state':
          setStates((s) => ({ ...s, [ev.agent]: { state: ev.state, text: ev.text } }));
          if (ev.state === 'working') worked.current.add(ev.agent);
          else if (worked.current.has(ev.agent)) setDoneIds((d) => new Set(d).add(ev.agent));
          break;
        case 'handoff':
          if (!ev.replay) setFlight({ key: ++flightKey.current, from: ev.from, to: ev.to, text: ev.text });
          addLog(ev.from, `→ ${nameOf.get(ev.to) ?? ev.to}: ${ev.text}`, 'sys');
          break;
        case 'meeting':
          if (ev.phase === 'start') {
            if (!ev.replay) setMeeting({ key: ++flightKey.current, host: ev.host, attendees: ev.attendees, topic: ev.topic });
            addLog(ev.host, `📣 เรียกประชุม: ${ev.topic}`, 'sys');
          } else if (!ev.replay) {
            setMeeting(null);
          }
          break;
        case 'log':
          addLog(ev.agent, ev.text, ev.level, ev.t);
          break;
        case 'file':
          setFiles((f) => [...f, { run: ev.run, path: ev.path, agent: ev.agent }]);
          break;
        case 'run':
          if (ev.status === 'start') { worked.current = new Set(); setDoneIds(new Set()); setLogs([]); setFiles([]); setApplyRun(null); setDoneRun(null); addLog('pm', 'รับงาน: ' + (ev.requirement ?? ''), 'sys'); }
          if (ev.status === 'done') {
            addLog(null, ev.applyable ? 'เสร็จสิ้น — ตรวจไฟล์ที่แก้ด้านล่าง แล้วกด "นำไปใช้" หรือ "ดาวน์โหลด" ถ้าโอเค' : 'เสร็จสิ้น', 'ok');
            if (ev.applyable) setApplyRun(ev.id);
            setDoneRun(ev.id);
            // โหมดสร้างใหม่: ถ้าผู้ใช้เลือกโฟลเดอร์ไว้ ให้บันทึกลงโฟลเดอร์นั้น · ถ้าเลือก "ดาวน์โหลด" จะรอให้กดปุ่มเอง (ไม่ดาวน์โหลดอัตโนมัติ)
            if (pendingSave.current && !ev.replay && (ev.mode ?? 'new') === 'new') {
              pendingSave.current = false;
              const dir = saveDirRef.current;
              if (dir) {
                fetch(`/api/run/${ev.id}/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: dir }) })
                  .then(async (r) => {
                    if (!r.ok) throw new Error(await r.text());
                    const j = (await r.json()) as { saved: string[]; skipped: string[] };
                    addLog(null, `บันทึก ${j.saved.length} ไฟล์ลงโฟลเดอร์ "${dir}" แล้ว` + (j.skipped.length ? ` · ข้าม ${j.skipped.length} ไฟล์ที่มีอยู่แล้ว` : ''), 'ok');
                  })
                  .catch((e: Error) => addLog(null, 'บันทึกลงโฟลเดอร์ไม่สำเร็จ: ' + e.message + ' — กดปุ่มดาวน์โหลดแทนได้', 'warn'));
              } else {
                addLog(null, 'ผลงานพร้อมแล้ว — กดปุ่ม "ดาวน์โหลดผลงาน (.zip)" ด้านขวาเมื่อต้องการ (หรือเลือกโฟลเดอร์ปลายทางก่อนส่งงานครั้งหน้า)', 'ok');
              }
            }
          }
          setBusy(ev.status === 'start');
          break;
      }
    };
    es.onerror = () => setConn(false);

    return () => { es.close(); };
  }, [addLog]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    if (workMode !== 'new' && !projPath.trim()) { addLog(null, 'กรุณาคลิกเลือกโฟลเดอร์โปรเจกต์ก่อน', 'error'); return; }
    pendingSave.current = workMode === 'new';
    setBusy(true);
    const r = await fetch('/api/task', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: t, mode: workMode, provider, meetings, path: workMode === 'new' ? '' : projPath }),
    });
    if (!r.ok) { addLog(null, 'ส่งงานไม่สำเร็จ: ' + (await r.text()), 'error'); setBusy(false); pendingSave.current = false; }
  }

  const pathValue = workMode === 'new' ? saveDir : projPath;
  const setPathValue = workMode === 'new' ? setSaveDir : setProjPath;
  const modeInfo = MODES.find((m) => m.id === workMode)!;

  const nWork = roster.filter((a) => states[a.id]?.state === 'working').length;
  const status = busy
    ? { cls: 'st-working', text: `กำลังทำงาน · ${nWork} คน`, summary: `กำลังทำงาน ${nWork} · ว่าง ${roster.length - nWork}` }
    : doneRun
      ? { cls: 'st-done', text: 'เสร็จแล้ว', summary: 'งานเสร็จแล้วทั้งทีม' }
      : { cls: 'st-idle', text: 'ว่าง', summary: `ว่างทั้งหมด ${roster.length} คน` };
  const field = { border: '1px solid var(--fieldb)', borderRadius: 12, background: 'var(--field)', color: 'var(--text)' } as const;

  return (
    <div className="ofc" data-theme={theme}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, padding: '6px 14px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--iconc)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16" /><path d="M14 10h5a1 1 0 0 1 1 1v10" /><path d="M2 21h20" /><path d="M8 8h2M8 12h2M8 16h2" /></svg>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Agents Office</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div role="group" aria-label="เลือกธีม" style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--muted)', marginRight: 6 }}>ธีม</span>
            {THEMES.map((t) => (
              <button key={t.id} type="button" className={'sw' + (theme === t.id ? ' on' : '')} aria-label={`ธีม ${t.label}`} aria-pressed={theme === t.id} title={t.label} onClick={() => setTheme(t.id)}>
                <span style={{ background: `linear-gradient(135deg,${t.a} 50%,${t.b} 50%)` }} />
              </button>
            ))}
          </div>
          <ProviderSelect value={provider} providers={providers} disabled={busy || !conn} onChange={setProvider} />
          <span className={'pill pill-lg ' + status.cls} role="status"><span className="dot" />{status.text}</span>
        </div>
      </header>

      <main className="dc-main">
        <TeamPanel roster={roster} states={states} doneIds={doneIds} />

        <section className="col-flex col" style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div className="flex min-h-0 flex-col lg:min-h-[300px] lg:flex-1">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px 6px' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>ออฟฟิศ</h2>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{status.summary}</span>
            </div>
            {/* ฉากออฟฟิศ: ย่อให้พอดีความกว้าง · จอเล็กเลื่อนซ้าย-ขวาได้ */}
            <div className="overflow-x-auto rounded-2xl lg:relative lg:min-h-0 lg:flex-1 lg:overflow-hidden" style={{ background: '#1C1566' }}>
              <div className="relative aspect-[1502/776] w-full overflow-hidden max-md:min-w-[760px] lg:absolute lg:inset-0 lg:aspect-auto">
                <OfficeScene roster={roster} depts={depts} states={states} flight={flight} meeting={meeting} />
              </div>
            </div>
          </div>

          <div className="panel dock-cmd" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, flex: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'inline-flex', padding: 3, background: 'var(--inset)', borderRadius: 10, gap: 2, flexWrap: 'wrap' }}>
                {MODES.map((m) => (
                  <button key={m.id} type="button" className={'seg' + (workMode === m.id ? ' on' : '')} aria-pressed={workMode === m.id} title={m.hint} onClick={() => setWorkMode(m.id)}
                    style={{ height: 32, padding: '0 12px', fontSize: 13 }}>{m.label}</button>
                ))}
              </div>
              <label title="เปิดแล้ว ก่อนเริ่มงานทีมจะประชุมกันจริง (ใช้ AI และเวลาเพิ่ม)" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, minHeight: 32, cursor: 'pointer' }}>
                <input type="checkbox" checked={meetings} disabled={busy} onChange={(e) => setMeetings(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
                ประชุมทีมก่อนเริ่มงาน
              </label>
            </div>

            <form onSubmit={submit} style={{ display: 'contents' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', flexWrap: 'wrap' }}>
                <label htmlFor="task" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>สั่งงานบริษัท</label>
                <textarea id="task" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={modeInfo.placeholder}
                  style={{ ...field, flex: '1 1 260px', minWidth: 0, boxSizing: 'border-box', padding: '9px 12px', fontSize: 14, lineHeight: 1.5, resize: 'none' }} />
                <button type="submit" className="btn-main" disabled={busy || !text.trim()} style={{ height: 'auto', minHeight: 44, padding: '0 18px', fontSize: 14, flex: '0 0 auto' }}>
                  {busy ? 'กำลังทำงาน…' : 'ส่งงานให้ทีม'}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                <button type="button" onClick={() => setPickerOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 32, padding: '0 12px', border: '1px dashed var(--dash)', borderRadius: 10, background: 'transparent', color: 'var(--text)', fontSize: 13, cursor: 'pointer', maxWidth: '100%' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pathValue || (workMode === 'new' ? 'เลือกโฟลเดอร์ปลายทาง (ไม่บังคับ)' : 'เลือกโฟลเดอร์โปรเจกต์')}
                  </span>
                </button>
                {pathValue && (
                  <button type="button" aria-label="ล้างโฟลเดอร์" onClick={() => setPathValue('')} style={{ height: 32, padding: '0 10px', border: '1px solid var(--fieldb)', borderRadius: 10, background: 'transparent', color: 'var(--text)', fontSize: 12, cursor: 'pointer' }}>ล้าง</button>
                )}
                <span style={{ fontSize: 12, color: 'var(--muted)', flex: '1 1 200px', minWidth: 0 }}>
                  {workMode === 'new' ? 'ไม่เลือก = ดาวน์โหลด .zip เมื่อเสร็จ' : 'ไฟล์ลับ (.env, key) ไม่ถูกส่งให้ AI'}
                  {projectsRoot ? ` · ภายใต้ ${projectsRoot}` : ''}
                </span>
              </div>
            </form>

            <FolderPicker open={pickerOpen} allowCreate={workMode === 'new'} initial={pathValue}
              onClose={() => setPickerOpen(false)} onPick={(rel) => { setPathValue(rel); setPickerOpen(false); }} />
            {applyRun && <ChangesPanel key={applyRun} runId={applyRun} onClose={() => setApplyRun(null)} />}
          </div>
        </section>

        <LogPanel roster={roster} depts={depts} logs={logs} files={files} downloadRun={busy ? null : doneRun} />
      </main>
    </div>
  );
}
