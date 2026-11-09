'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProviderChoice, ProviderInfo } from '@/lib/llm';

const COLOR: Record<ProviderChoice, string> = { anthropic: '#F5A962', openai: '#4ADE80', gemini: '#60A5FA', mock: '#A78BFA' };
const SHORT: Record<ProviderChoice, string> = { anthropic: 'C', openai: 'G', gemini: 'G', mock: '⚙' };

function Badge({ id }: { id: ProviderChoice }) {
  return (
    <span aria-hidden="true" style={{
      width: 28, height: 28, borderRadius: 8, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 13, fontWeight: 700, color: COLOR[id], background: `color-mix(in srgb, ${COLOR[id]} 18%, transparent)`,
    }}>{SHORT[id]}</span>
  );
}

/** เลือกค่าย AI: ปุ่มแสดงค่ายที่ใช้อยู่ + รายการตัวเลือกพร้อมสถานะ key */
export default function ProviderSelect({ value, providers, disabled, onChange }: {
  value: ProviderChoice; providers: ProviderInfo[]; disabled?: boolean; onChange: (v: ProviderChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const cur = providers.find((p) => p.id === value) ?? providers[0];

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  if (!cur) return null;
  return (
    <div ref={root} style={{ position: 'relative' }}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label="เลือกค่าย AI" disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 12px 0 8px', minWidth: 220,
          border: '1px solid var(--fieldb)', borderRadius: 12, background: 'var(--panel)', color: 'var(--text)',
          cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, textAlign: 'left',
        }}>
        <Badge id={cur.id} />
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{cur.id === 'mock' ? 'โหมดจำลอง' : cur.label}</span>
          <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {cur.id === 'mock' ? 'ไม่เรียก AI จริง' : cur.model}
          </span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}><path d="m6 9 6 6 6-6" /></svg>
      </button>

      {open && (
        <ul role="listbox" aria-label="ค่าย AI" style={{
          position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 50, minWidth: 300, margin: 0, padding: 6, listStyle: 'none',
          background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 16px 40px rgba(0,0,0,.35)',
        }}>
          {providers.map((p) => {
            const sel = p.id === value;
            const ready = p.ready;
            return (
              <li key={p.id} role="option" aria-selected={sel} aria-disabled={!ready}
                onClick={() => { if (!ready) return; onChange(p.id); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10,
                  cursor: ready ? 'pointer' : 'not-allowed', opacity: ready ? 1 : 0.55,
                  background: sel ? 'var(--seg)' : 'transparent', color: sel ? 'var(--segt)' : 'var(--text)',
                }}>
                <Badge id={p.id} />
                <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{p.id === 'mock' ? 'โหมดจำลอง' : p.label}</span>
                  <span style={{ fontSize: 11, opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.id === 'mock' ? 'ไม่เรียก AI จริง (ไม่ใช้ key)' : p.model}
                  </span>
                </span>
                {p.id === 'mock' ? null : (
                  <span className={'pill ' + (ready ? 'st-idle' : 'st-working')} style={{ fontSize: 11, padding: '2px 8px' }}>
                    {ready ? 'พร้อมใช้' : 'ยังไม่ได้ตั้ง key'}
                  </span>
                )}
                {sel && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
