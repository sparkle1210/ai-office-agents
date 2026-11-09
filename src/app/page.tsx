import OfficeApp, { type InitialOffice } from '@/components/OfficeApp';
import { AGENTS, DEPTS } from '@/lib/agents';
import { defaultProvider, listProviders } from '@/lib/llm';
import { PROJECTS_ROOT } from '@/lib/project';

// อ่าน env ตอนมี request เสมอ (ไม่ให้ถูก build ตรึงค่าไว้)
export const dynamic = 'force-dynamic';

export default function Page() {
  // ส่งข้อมูลพื้นฐานมากับ HTML เลย — รีเฟรชแล้วเห็นพนักงานทันที ไม่ต้องรอ SSE เชื่อมต่อ
  const initial: InitialOffice = {
    roster: AGENTS.map(({ system: _system, ...pub }) => pub),
    depts: DEPTS,
    providers: listProviders(),
    defaultProvider: defaultProvider(),
    projectsRoot: PROJECTS_ROOT,
  };
  return <OfficeApp initial={initial} />;
}
