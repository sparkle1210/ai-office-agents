import { AGENTS, DEPTS } from '@/lib/agents';
import { store } from '@/lib/bus';
import { defaultProvider, listProviders } from '@/lib/llm';
import { PROJECTS_ROOT } from '@/lib/project';
import type { HelloEvent, PublicAgent, ServerEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Server-Sent Events: ส่งสถานะบริษัท + เหตุการณ์สดไปให้หน้าเว็บ */
export async function GET(request: Request) {
  const enc = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (ev: ServerEvent) => {
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)); } catch { cleanup(); }
      };

      const roster: PublicAgent[] = AGENTS.map(({ system: _system, ...pub }) => pub);
      const hello: HelloEvent = {
        type: 'hello', roster, depts: DEPTS, providers: listProviders(), defaultProvider: defaultProvider(),
        busy: store.busy, projectsRoot: PROJECTS_ROOT, agentState: store.agentState,
      };
      send(hello);
      for (const ev of store.history) send({ ...ev, replay: true });

      store.listeners.add(send);
      const ping = setInterval(() => {
        try { controller.enqueue(enc.encode(': ping\n\n')); } catch { cleanup(); }
      }, 15000);

      cleanup = () => {
        clearInterval(ping);
        store.listeners.delete(send);
        try { controller.close(); } catch { /* ปิดไปแล้ว */ }
      };
      request.signal.addEventListener('abort', cleanup);
    },
    cancel() { cleanup(); },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
