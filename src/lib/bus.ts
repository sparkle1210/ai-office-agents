// สถานะฝั่งเซิร์ฟเวอร์ที่ใช้ร่วมกันทุก request (เก็บบน globalThis เพื่อรอด hot-reload ของ Next dev)

import { AGENTS } from './agents';
import type { Bus, OfficeEvent, ServerEvent, WorkState } from './types';

type Listener = (ev: ServerEvent) => void;

interface Store {
  listeners: Set<Listener>;
  history: ServerEvent[];
  agentState: Record<string, { state: WorkState; text: string }>;
  busy: boolean;
}

const g = globalThis as unknown as { __aiOffice?: Store };

export const store: Store = (g.__aiOffice ??= {
  listeners: new Set(),
  history: [],
  agentState: Object.fromEntries(AGENTS.map((a) => [a.id, { state: 'idle' as WorkState, text: '' }])),
  busy: false,
});

function emit(ev: OfficeEvent): void {
  const full: ServerEvent = { ...ev, t: Date.now() };
  store.history.push(full);
  if (store.history.length > 500) store.history.shift();
  for (const fn of store.listeners) fn(full);
}

export const MEETING_MS = 7000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const bus: Bus = {
  state(agent, state, text) {
    store.agentState[agent] = { state, text };
    emit({ type: 'state', agent, state, text });
  },
  log(agent, text, level = 'info') {
    emit({ type: 'log', agent, text, level });
  },
  async handoff(from, to, text) {
    emit({ type: 'handoff', from, to, text });
    await sleep(2000); // รอให้ซองเมลบินไปถึงผู้รับ
  },
  async meeting<T>(host: string, attendees: string[], topic: string, work?: () => Promise<T>): Promise<T | undefined> {
    emit({ type: 'meeting', phase: 'start', host, attendees, topic });
    try {
      const [r] = await Promise.all([work ? work() : Promise.resolve(undefined), sleep(MEETING_MS)]);
      return r as T | undefined;
    } finally {
      emit({ type: 'meeting', phase: 'end', host, attendees, topic });
    }
  },
  file(run, path, agent) {
    emit({ type: 'file', run, path, agent });
  },
  run(info) {
    emit({ type: 'run', ...info });
  },
};
