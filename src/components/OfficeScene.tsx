'use client';

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DeptId, DeptInfo, PublicAgent } from '@/lib/types';
import { CX, CY, P, PM, SEATS, buildSceneHtml } from '@/lib/scene-html';

export interface Meeting { key: number; host: string; attendees: string[]; topic: string }
export interface Flight { key: number; from: string; to: string; text: string }
type States = Record<string, { state: 'idle' | 'working'; text: string }>;

// กรอบที่แสดงจริง (ตัดขอบว่างของกรอบออกแบบ 1600×1000 ออก) แล้วย่อให้พอดีพื้นที่
const DW = 1280, DH = 740, OFFX = 40, OFFY = -55;

const ZONE_LABEL: Record<DeptId, string> = {
  product: 'PRODUCT', design: 'DESIGN', frontend: 'FRONTEND', backend: 'BACKEND', qa: 'QA', devops: 'DEVOPS', security: 'SECURITY',
};
const d3: React.CSSProperties = { transformStyle: 'preserve-3d' };
const glass = 'rgba(255,255,255,.9)';

// เส้นทางเดินไปห้องประชุม: ออกจากเก้าอี้ไปทางเดิน → เดินตามเลนไปหน้าห้อง → เข้าประตูด้านใต้ → ไปที่นั่ง/จุดยืนในห้อง
const YL = [-281, -103, 103, 281];
const XL = [0, 400];
const DOOR_X = 200;
const HOST_SPOT: [number, number] = [350, -360];
const MEET_SPOTS: [number, number][] = [
  [150, -398], [200, -398], [250, -398], [290, -398], [150, -322], [200, -322], [250, -322], [290, -322],
  [85, -360], [85, -330], [85, -390], [350, -320], [350, -400],
];
function exitLane(seat: [number, number, number]) {
  const [, sy, off] = seat;
  const pick = (dir: number) => YL.filter((l) => (l - sy) * dir > 0).sort((a, b) => Math.abs(a - sy) - Math.abs(b - sy))[0];
  const d = off > 0 ? -1 : 1; // โต๊ะอยู่ทาง +y => ออกทาง -y
  return pick(d) ?? pick(-d);
}
function routeToMeeting(seat: [number, number, number], spot: [number, number]): [number, number][] {
  const fx = seat[0], la = exitLane(seat);
  const pts: [number, number][] = [[fx, la]];
  if (la !== -281) {
    let xl = XL[0], best = Infinity;
    for (const c of XL) { const d = Math.abs(fx - c) + Math.abs(c - DOOR_X); if (d < best) { best = d; xl = c; } }
    pts.push([xl, la], [xl, -281]);
  }
  pts.push([DOOR_X, -281], [DOOR_X, -308], [spot[0], spot[1]]);
  return pts;
}

const Static = memo(function Static() {
  const html = useMemo(buildSceneHtml, []);
  return (
    <>
      <div id="floor" style={{ position: 'absolute', left: CX, top: CY, width: 0, height: 0, transformStyle: 'preserve-3d', transform: 'rotateX(60deg) rotateZ(45deg)' }}>
        <div style={d3} dangerouslySetInnerHTML={{ __html: html.floor }} />
        <div className="pl floortop" style={{ left: -440, top: -440, width: 880, height: 880, border: '2px solid #7c5cff' }} />
        <div style={d3} dangerouslySetInnerHTML={{ __html: html.props }} />
        <div style={d3} dangerouslySetInnerHTML={{ __html: html.desks }} />
      </div>
    </>
  );
});

function Pill({ x, y, z, children, style }: { x: number; y: number; z?: number; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      position: 'absolute', left: x, top: y, transform: 'translateX(-50%)', zIndex: z ?? Math.round(y) + 400,
      background: glass, color: '#1a1440', borderRadius: 999, padding: '5px 14px', whiteSpace: 'nowrap',
      boxShadow: '0 3px 10px rgba(10,6,40,.3)', fontFamily: "'Prompt','Noto Sans Thai',sans-serif", fontWeight: 700, fontSize: 13, ...style,
    }}>{children}</div>
  );
}

interface Props {
  roster: PublicAgent[];
  depts: Record<DeptId, DeptInfo> | null;
  states: States;
  flight: Flight | null;
  meeting: Meeting | null;
}

export default function OfficeScene({ roster, depts, states, flight, meeting }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0); // 0 = ยังไม่ได้วัดขนาด (ซ่อนไว้ ไม่ให้เห็นภาพขยายชั่วคราวตอนรีเฟรช)
  // ส่งเมล: ซองจดหมายบินจากโต๊ะผู้ส่งไปโต๊ะผู้รับ แล้วผู้รับมีบับเบิลแจ้ง "ได้รับเมลแล้ว"
  const [mail, setMail] = useState<{ key: number; text: string; color: string; x: number; y: number; go: boolean } | null>(null);
  const mounted = useRef(true);
  // เดินไปห้องประชุม
  const [walk, setWalk] = useState<Record<string, { x: number; y: number; dur: number; moving: boolean }>>({});
  const chain = useRef<Record<string, Promise<void>>>({});
  const endResolvers = useRef<(() => void)[]>([]);
  // ประชุมจบ (meeting กลับเป็น null) → ปล่อยทุกคนให้เดินกลับโต๊ะ
  useEffect(() => {
    if (!meeting) { endResolvers.current.forEach((r) => r()); endResolvers.current = []; }
  }, [meeting]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const upd = () => {
      if (!el.clientWidth || !el.clientHeight) return;
      setScale(Math.max(0.2, Math.min(el.clientWidth / DW, el.clientHeight / DH) * 0.94));
    };
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    // รีเฟรช: เลย์เอาต์ยังขยับได้หลังโหลด (ฟอนต์/สไตล์/ค่าที่จำไว้) → วัดซ้ำเมื่อพร้อม
    window.addEventListener('resize', upd);
    window.addEventListener('load', upd);
    document.fonts?.ready.then(upd).catch(() => {});
    const t = setTimeout(upd, 300);
    return () => { ro.disconnect(); window.removeEventListener('resize', upd); window.removeEventListener('load', upd); clearTimeout(t); };
  }, []);

  const people = useMemo(() => {
    const seen = new Set<string>();
    return roster.filter((a) => SEATS[a.id]).map((a) => {
      const [cx, cy] = SEATS[a.id];
      const f = P(cx, cy, 10);
      const first = !seen.has(a.dept);
      seen.add(a.dept);
      return { a, x: f.x, y: f.y, first };
    });
  }, [roster]);

  // ป้ายชื่อโซน: วางที่กึ่งกลางของคนในโซนนั้น (ไม่ทับตัวใคร และอยู่ชั้นบนสุดเสมอ)
  const zones = useMemo(() => {
    const m = new Map<DeptId, { dept: DeptId; x: number; y: number; n: number }>();
    people.forEach((p) => {
      const z = m.get(p.a.dept) ?? { dept: p.a.dept, x: 0, y: 0, n: 0 };
      z.x += p.x; z.y += p.y; z.n++;
      m.set(p.a.dept, z);
    });
    return [...m.values()].map((z) => ({ dept: z.dept, x: z.x / z.n, y: z.y / z.n }));
  }, [people]);

  useEffect(() => {
    if (!flight || !depts) return;
    const f = people.find((p) => p.a.id === flight.from), t = people.find((p) => p.a.id === flight.to);
    if (!f || !t || f === t) return;
    const color = depts[f.a.dept].color;
    setMail({ key: flight.key, text: flight.text, color, x: f.x, y: f.y - 70, go: false });
    const r = requestAnimationFrame(() => requestAnimationFrame(() =>
      setMail((c) => (c && c.key === flight.key ? { ...c, x: t.x, y: t.y - 70, go: true } : c))));
    const arrive = setTimeout(() => setMail((c) => (c && c.key === flight.key ? null : c)), 1400);
    return () => { cancelAnimationFrame(r); clearTimeout(arrive); };
  }, [flight, people, depts]);

  useEffect(() => {
    if (!meeting) return;
    const ids = [meeting.host, ...meeting.attendees.filter((i) => i !== meeting.host)].filter((id, i, arr) => SEATS[id] && arr.indexOf(id) === i);
    const ended = new Promise<void>((r) => { endResolvers.current.push(r); });
    const SPEED = 260; // px/วินาที (พิกัดหน้าจอ)
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    let next = 0;
    ids.forEach((id) => {
      const spot = id === meeting.host ? HOST_SPOT : MEET_SPOTS[next++ % MEET_SPOTS.length];
      const seat = SEATS[id];
      const home = P(seat[0], seat[1], 10);
      const pts = routeToMeeting(seat, spot).map(([x, y]) => P(x, y, 10));
      const run = async () => {
        let cur = { x: home.x, y: home.y };
        const go = async (p: { x: number; y: number }) => {
          if (!mounted.current) return;
          const dur = Math.max(120, (Math.hypot(p.x - cur.x, p.y - cur.y) / SPEED) * 1000);
          setWalk((w) => ({ ...w, [id]: { x: p.x, y: p.y, dur, moving: true } }));
          cur = p;
          await sleep(dur + 40);
          if (mounted.current) setWalk((w) => (w[id] ? { ...w, [id]: { ...w[id], moving: false } } : w));
        };
        for (const p of pts) await go(p);
        await Promise.race([ended, sleep(10 * 60 * 1000)]); // นั่ง/ยืนประชุมจนประชุมจบ
        for (const p of [...pts].reverse().slice(1)) await go(p);
        await go(home);
        if (mounted.current) setWalk((w) => { const n = { ...w }; delete n[id]; return n; });
      };
      chain.current[id] = (chain.current[id] ?? Promise.resolve()).then(run);
    });
  }, [meeting?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const tp = P(0, 103, 12), rp = P(340, -395, 66), pp = P(PM.x - 20, PM.y + PM.h * 0.85, 95);

  return (
    <div ref={hostRef} className="absolute inset-0">
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: DW, height: DH, transform: `translate(-50%,-50%) scale(${scale || 1})`, transformOrigin: 'center', visibility: scale ? 'visible' : 'hidden' }}>
        <div style={{ position: 'absolute', left: OFFX, top: OFFY, width: 1600, height: 1000 }}>
          <Static />

          {zones.filter((z) => z.dept !== 'product').map((z) => depts && (
            <Pill key={z.dept} x={z.x} y={z.y + 30} z={3000} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, letterSpacing: '.06em', padding: '4px 12px' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: depts[z.dept].color }} />{ZONE_LABEL[z.dept]}
            </Pill>
          ))}
          <Pill x={tp.x} y={tp.y - 52} style={{ borderRadius: 12, textAlign: 'center', padding: '6px 14px' }}>
            <div style={{ fontSize: 14 }}>Team Sync</div>
            <div style={{ fontSize: 11, fontWeight: 400, color: '#4a4680', fontFamily: "'Noto Sans Thai',sans-serif" }}>จุดประชุมกลาง</div>
          </Pill>
          {meeting && (
            <Pill x={rp.x} y={rp.y - 78} z={3200} style={{ background: '#7c5cff', color: '#fff', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', boxShadow: '0 0 18px #7c5cff' }}>
              📣 {meeting.topic}
            </Pill>
          )}
          <Pill x={rp.x} y={rp.y - 6} z={3000} style={meeting ? { background: '#7c5cff', color: '#fff', boxShadow: '0 0 18px #7c5cff' } : undefined}>
            Meeting Room{meeting ? ' · กำลังประชุม' : ''}
          </Pill>
          <Pill x={pp.x} y={pp.y} z={3000} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: depts?.product.color ?? '#f5a65b' }} />Product Office
          </Pill>

          {people.map(({ a, x: sx, y: sy }) => {
            const w = walk[a.id];
            const x = w ? w.x : sx, y = w ? w.y : sy;
            const moving = !!w?.moving;
            const inMeet = !!meeting && (meeting.host === a.id || meeting.attendees.includes(a.id));
            const bubble = meeting?.host === a.id ? '📣 เรียกประชุม' : '';
            const s = states[a.id];
            const working = s?.state === 'working';
            const color = depts?.[a.dept].color ?? '#7a77ad';
            return (
              <div key={a.id} className="agentwrap" title={a.name} style={{
                position: 'absolute', width: 0, height: 0, left: x, top: y, zIndex: w ? 2500 : Math.round(y) + 400,
                transition: w ? `left ${w.dur}ms linear, top ${w.dur}ms linear` : 'none',
              }}>
                {inMeet && <div className="meetring" />}
                <div className={'av' + (working && !moving ? ' work' : '') + (moving ? ' walk' : '')}>
                  {moving && (<><div className="px leg l1" style={{ left: 7, top: 44, width: 7, height: 8, background: '#2f3542' }} /><div className="px leg l2" style={{ left: 18, top: 44, width: 7, height: 8, background: '#2f3542' }} /></>)}
                  <div className="px" style={{ left: 0, top: 26, width: 6, height: 16, background: a.skin }} />
                  <div className="px" style={{ left: 26, top: 26, width: 6, height: 16, background: a.skin }} />
                  <div className="px" style={{ left: 3, top: 24, width: 26, height: 22, borderRadius: '4px 4px 0 0', background: color }} />
                  <div className="px" style={{ left: 5, top: 6, width: 22, height: 18, background: a.skin }}>
                    <div style={{ position: 'absolute', left: 5, top: 8, width: 3, height: 3, background: '#1a1440' }} />
                    <div style={{ position: 'absolute', left: 14, top: 8, width: 3, height: 3, background: '#1a1440' }} />
                    <div style={{ position: 'absolute', left: 8, top: 14, width: 6, height: 2, background: '#b5654a' }} />
                  </div>
                  <div className="px" style={{ left: 3, top: 0, width: 26, height: 10, background: a.hair }} />
                </div>
                {w && moving && (
                  <div data-chip={a.id} style={{
                    position: 'absolute', left: -34, top: 4, width: 68, boxSizing: 'border-box', padding: '1px 6px', borderRadius: 9, textAlign: 'center',
                    background: 'rgba(255,255,255,.96)', border: `2px solid ${inMeet ? '#7c5cff' : color}`, fontFamily: "'Prompt','Noto Sans Thai',sans-serif", fontWeight: 700, fontSize: 12, color: '#1a1440', lineHeight: 1.35,
                  }}>{a.name}</div>
                )}
                {!w && <div data-card={a.id} style={{
                  position: 'absolute', left: working ? -68 : -58, bottom: 56, width: working ? 136 : 116, boxSizing: 'border-box', padding: '5px 9px', borderRadius: 11,
                  background: 'rgba(255,255,255,.96)', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 0,
                  border: `2px solid ${inMeet ? '#7c5cff' : working ? color : 'transparent'}`, boxShadow: inMeet ? '0 0 18px #7c5cff' : working ? `0 0 18px ${color}` : '0 4px 10px rgba(10,6,40,.3)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ fontFamily: "'Prompt','Noto Sans Thai',sans-serif", fontWeight: 700, fontSize: 14, color: '#1a1440', lineHeight: 1.25 }}>{a.name}</span>
                    <span className={working ? 'dotw' : ''} style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: working ? color : '#9a97c4' }} />
                  </div>
                  <div style={{ fontSize: 10.5, color: '#4a4680', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>{a.title}</div>
                  {working && (
                    <div style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#6d28d9', marginTop: 1 }}>
                      {s.text || 'กำลังทำงาน'}
                    </div>
                  )}
                </div>}
                {bubble && !w && (
                  <div data-bub={a.id} style={{
                    position: 'absolute', left: -70, bottom: 122, width: 140, boxSizing: 'border-box', padding: '4px 9px', borderRadius: 12, textAlign: 'center',
                    background: '#fff3b0', border: '2px solid #1a1440', fontSize: 12, fontWeight: 600, color: '#1a1440', lineHeight: 1.3, boxShadow: `0 0 14px ${color}`,
                  }}>{bubble}</div>
                )}
              </div>
            );
          })}

          {mail && (
            <div style={{
              position: 'absolute', left: mail.x, top: mail.y, zIndex: 3500, transform: 'translate(-50%,-100%)', maxWidth: 220, pointerEvents: 'none',
              transition: mail.go ? 'left 1.3s ease-in-out, top 1.3s ease-in-out' : 'none',
              background: '#fff3b0', border: '2px solid #1a1440', borderRadius: 12, padding: '3px 10px', fontSize: 12, fontWeight: 600, color: '#1a1440',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', boxShadow: `0 0 14px ${mail.color}`,
            }}>✉ {mail.text}</div>
          )}
        </div>
      </div>
    </div>
  );
}
