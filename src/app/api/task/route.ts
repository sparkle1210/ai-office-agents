import { bus, store } from '@/lib/bus';
import { runTask } from '@/lib/orchestrator';
import { defaultProvider, isReady, type ProviderChoice } from '@/lib/llm';
import { resolveInRoot, type Mode } from '@/lib/project';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODES: Mode[] = ['new', 'modify', 'review'];

export async function POST(request: Request) {
  let meetings = false, text = '', mode: Mode = 'new', pathInput = '', provider: ProviderChoice = defaultProvider();
  try {
    const body = (await request.json()) as { text?: unknown; mode?: unknown; path?: unknown; provider?: unknown; meetings?: unknown };
    text = typeof body.text === 'string' ? body.text.trim() : '';
    if (typeof body.mode === 'string' && MODES.includes(body.mode as Mode)) mode = body.mode as Mode;
    if (body.provider !== undefined && (typeof body.provider !== 'string' || !isReady(body.provider))) return new Response('ค่าย AI ที่เลือกยังไม่พร้อมใช้ (ยังไม่ได้ตั้ง API key)', { status: 400 });
    if (typeof body.provider === 'string') provider = body.provider as ProviderChoice;
    meetings = body.meetings === true;
    pathInput = typeof body.path === 'string' ? body.path.trim() : '';
  } catch {
    return new Response('bad request', { status: 400 });
  }
  if (!text) return new Response('กรุณาพิมพ์โจทย์', { status: 400 });
  if (text.length > 5000) return new Response('โจทย์ยาวเกินไป', { status: 400 });
  if (store.busy) return new Response('ทีมกำลังทำงานอยู่', { status: 409 });

  // ตรวจ path ก่อนเริ่มงาน (ต้องอยู่ใต้ PROJECTS_ROOT)
  let target: string | null = null;
  try {
    if (mode !== 'new' && !pathInput) throw new Error('กรุณาระบุ path ของโปรเจกต์');
    if (pathInput) target = resolveInRoot(pathInput, { mustExist: mode !== 'new' });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : 'path ไม่ถูกต้อง', { status: 400 });
  }

  store.busy = true;
  store.history.length = 0;
  void runTask(text, bus, { mode, target, provider, meetings }).finally(() => { store.busy = false; });
  return new Response('ok', { status: 202 });
}
