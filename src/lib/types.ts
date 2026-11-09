import type { ProviderChoice, ProviderInfo } from './llm';
export type DeptId = 'product' | 'design' | 'frontend' | 'backend' | 'qa' | 'security' | 'devops';

export interface DeptInfo {
  label: string;
  color: string;
}

export interface Agent {
  id: string;
  name: string;
  title: string;
  dept: DeptId;
  lead: boolean;
  hair: string;
  skin: string;
  /** ตำแหน่งโต๊ะบนแผนที่ (หน่วย tile 16px) */
  seat: { x: number; y: number };
  system: string;
}

export type PublicAgent = Omit<Agent, 'system'>;
export type WorkState = 'idle' | 'working';
export type LogLevel = 'info' | 'warn' | 'error' | 'ok' | 'sys';

export interface HelloEvent {
  type: 'hello';
  roster: PublicAgent[];
  depts: Record<DeptId, DeptInfo>;
  /** ค่าย AI ที่เลือกได้ (ready = มี key แล้ว) — key ไม่ถูกส่งมาหน้าเว็บ */
  providers: ProviderInfo[];
  defaultProvider: ProviderChoice;
  busy: boolean;
  /** โฟลเดอร์แม่ที่อนุญาตให้ AI ทำงานกับโปรเจกต์เก่า (null = ยังไม่ได้ตั้ง PROJECTS_ROOT) */
  projectsRoot: string | null;
  agentState: Record<string, { state: WorkState; text: string }>;
}
export interface StateEvent { type: 'state'; agent: string; state: WorkState; text: string }
export interface LogEvent { type: 'log'; agent: string | null; text: string; level: LogLevel }
export interface HandoffEvent { type: 'handoff'; from: string; to: string; text: string }
export interface FileEvent { type: 'file'; run: string; path: string; agent: string }
export interface RunEvent {
  type: 'run';
  status: 'start' | 'done' | 'error';
  id: string;
  requirement?: string;
  mode?: 'new' | 'modify' | 'review';
  target?: string | null;
  /** true = มีไฟล์ที่ AI แก้พร้อมให้ตรวจ diff และกด "นำไปใช้" */
  applyable?: boolean;
  summary?: string;
  error?: string;
}

export interface MeetingEvent { type: 'meeting'; phase: 'start' | 'end'; host: string; attendees: string[]; topic: string }

export type OfficeEvent = StateEvent | LogEvent | HandoffEvent | MeetingEvent | FileEvent | RunEvent;
export type ServerEvent = (HelloEvent | OfficeEvent) & { t?: number; replay?: boolean };

/** ช่องทางที่ orchestrator ใช้ส่งเหตุการณ์ไปหน้าจอ */
export interface Bus {
  state(agent: string, state: WorkState, text: string): void;
  log(agent: string | null, text: string, level?: LogLevel): void;
  handoff(from: string, to: string, text: string): Promise<void>;
  /** เรียกประชุม: host เรียก attendees เข้าห้องประชุม แล้วทำ work (ถ้ามี) ระหว่างประชุม · จบเมื่อ work เสร็จ (และอยู่ครบเวลาขั้นต่ำ) */
  meeting<T = void>(host: string, attendees: string[], topic: string, work?: () => Promise<T>): Promise<T | undefined>;
  file(run: string, path: string, agent: string): void;
  run(info: Omit<RunEvent, 'type'>): void;
}
