'use client';

import { useEffect, useRef } from 'react';
import type { DeptId, DeptInfo, LogLevel, PublicAgent, WorkState } from '@/lib/types';

export interface LogItem { id: number; agent: string | null; text: string; level: LogLevel; time: string }
export interface FileItem { run: string; path: string; agent: string }
export type AgentStates = Record<string, { state: WorkState; text: string }>;

const AV: Record<DeptId, string> = {
  product: 'av-pm', design: 'av-design', frontend: 'av-fe', backend: 'av-be', qa: 'av-qa', security: 'av-sec', devops: 'av-ops',
};

const LEVEL: Record<LogLevel, string | undefined> = {
  info: undefined, sys: undefined, warn: 'var(--warn)', error: 'var(--err)', ok: 'var(--okt)',
};

const h2 = { margin: 0, fontSize: 16, fontWeight: 600 } as const;
const empty = { margin: 0, fontSize: 14, color: 'var(--muted)' } as const;

/** ทีมงาน (คอลัมน์ซ้าย) */
export function TeamPanel({ roster, states, doneIds }: { roster: PublicAgent[]; states: AgentStates; doneIds: Set<string> }) {
  return (
    <aside className="panel col" style={{ padding: '12px 8px' }}>
      <h2 style={{ margin: '0 10px 6px', fontSize: 15, fontWeight: 600, color: 'var(--muted)' }}>ทีมงาน</h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
        {roster.map((a) => {
          const s = states[a.id];
          const st = s?.state === 'working' ? 'working' : doneIds.has(a.id) ? 'done' : 'idle';
          const label = { idle: 'ว่าง', working: 'กำลังทำงาน', done: 'เสร็จแล้ว' }[st];
          return (
            <li key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '5px 10px', borderRadius: 10 }}>
              <span className={'mav ' + AV[a.dept]}>{a.name[0]}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{a.name}</span>
                  <span className={'pill st-' + st}><span className="dot" />{label}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {st === 'working' && s.text ? s.text : a.title}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

/** บันทึกการทำงาน + ไฟล์ที่ทีมส่งมอบ (คอลัมน์ขวา) */
export function LogPanel({ roster, depts, logs, files, downloadRun }: {
  roster: PublicAgent[]; depts: Record<DeptId, DeptInfo> | null; logs: LogItem[]; files: FileItem[]; downloadRun?: string | null;
}) {
  const logRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);
  const byId = new Map(roster.map((a) => [a.id, a]));

  return (
    <aside className="col-flex col" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="panel grow" style={{ padding: 14, minHeight: 240, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={h2}>บันทึกการทำงาน</h2>
        {logs.length === 0 && <p style={empty}>พร้อมรับงานค่ะ</p>}
        <ul ref={logRef} className="loglist" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
          {logs.map((l) => {
            const a = l.agent ? byId.get(l.agent) : undefined;
            return (
              <li key={l.id} style={{ fontSize: 14, lineHeight: 1.5 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{l.time} · {a ? a.name : 'บริษัท'}</div>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: LEVEL[l.level], fontStyle: l.level === 'sys' ? 'italic' : undefined }}>{l.text}</div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="panel dock" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={h2}>ไฟล์ที่ทีมส่งมอบ {files.length > 0 && <span style={{ color: 'var(--iconc)', fontWeight: 500 }}>({files.length} ไฟล์)</span>}</h2>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {downloadRun ? (
            <a className="btn-main" href={`/api/run/${downloadRun}/download`} download style={{ textDecoration: 'none' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></svg>
              ดาวน์โหลด (.zip)
            </a>
          ) : (
            <>
              <button type="button" className="btn-main" disabled>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></svg>
                ดาวน์โหลด (.zip)
              </button>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มีไฟล์</span>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
