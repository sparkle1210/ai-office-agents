'use client';

import { useEffect, useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Paper, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

interface Change { path: string; status: 'added' | 'modified'; diff: string; conflict: boolean }
interface DiffResponse {
  id: string; mode: string; target: string | null;
  applied: { at: string; backupDir: string | null; files: string[] } | null;
  changes: Change[];
}
interface ApplyResult { applied: string[]; skipped: string[]; backupDir: string | null }

export default function ChangesPanel({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [data, setData] = useState<DiffResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/run/${runId}/diff`)
      .then(async (r) => (r.ok ? ((await r.json()) as DiffResponse) : Promise.reject(new Error(await r.text()))))
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [runId, result]);

  async function apply() {
    if (!data) return;
    setConfirmOpen(false);
    setBusy(true); setError('');
    const r = await fetch(`/api/run/${runId}/apply`, { method: 'POST' });
    if (r.ok) setResult((await r.json()) as ApplyResult);
    else setError(await r.text());
    setBusy(false);
  }

  const box = 'mt-4 !rounded-2xl border-2 border-brand !bg-card2 p-3.5 !shadow-none';
  if (error && !data) return <Paper className={box}><Typography color="text.secondary">{error}</Typography></Paper>;
  if (!data) return <Paper className={box}><Typography color="text.secondary">กำลังเทียบไฟล์…</Typography></Paper>;

  const applicable = data.changes.filter((c) => !c.conflict);
  const applied = data.applied;

  return (
    <Paper className={box}>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Typography className="!font-bold">{applied ? '✅ นำไปใช้แล้ว' : `AI แก้ ${data.changes.length} ไฟล์ — ตรวจก่อนนำไปใช้`}</Typography>
          <Typography variant="caption" color="text.secondary" className="break-all">โปรเจกต์จริง: {data.target}</Typography>
        </div>
        <div className="flex gap-2">
          {!applied && (
            <Button variant="contained" color="success" disabled={busy || applicable.length === 0} onClick={() => setConfirmOpen(true)}>
              {busy ? 'กำลังเขียน…' : `นำไปใช้ ${applicable.length} ไฟล์`}
            </Button>
          )}
          <Button component="a" href={`/api/run/${runId}/download`} download variant="outlined" color="primary" startIcon={<DownloadIcon />} className="!bg-white">
            ดาวน์โหลดไฟล์ที่แก้
          </Button>
          <Button variant="outlined" color="inherit" onClick={onClose} className="!bg-white !border-line">{applied ? 'ปิด' : 'ไม่นำไปใช้'}</Button>
        </div>
      </div>

      {applied && (
        <Alert severity="success" className="!my-2">
          เขียนแล้ว {applied.files.length} ไฟล์
          {applied.backupDir && <> · สำรองไฟล์เดิมไว้ที่ <code>{applied.backupDir}</code></>}
          {result && result.skipped.length > 0 && <> · ข้าม {result.skipped.length} ไฟล์ที่ถูกแก้ระหว่างทาง</>}
        </Alert>
      )}
      {!applied && data.changes.some((c) => c.conflict) && (
        <Alert severity="warning" className="!my-2">
          บางไฟล์ในโปรเจกต์จริงถูกแก้หลังจากที่ AI เริ่มทำงาน — ไฟล์เหล่านั้นจะไม่ถูกเขียนทับ (ติดป้าย ⚠)
        </Alert>
      )}
      {error && <Alert severity="error" className="!my-2">{error}</Alert>}
      {data.changes.length === 0 && <Typography color="text.secondary">ไม่มีไฟล์ที่ต่างจากของจริง</Typography>}

      {data.changes.map((c) => (
        <Accordion key={c.path} defaultExpanded={data.changes.length <= 3} disableGutters elevation={0} square
          className="!border-t-2 !border-line !bg-transparent before:!hidden">
          <AccordionSummary expandIcon={<ExpandMoreIcon />} className="!px-0">
            <div className="flex flex-wrap items-center gap-2 break-all text-[13.5px] font-semibold">
              <Chip size="small" label={c.status === 'added' ? 'ใหม่' : 'แก้'} color={c.status === 'added' ? 'success' : 'info'} className="!h-5 !text-[11px] !font-extrabold" />
              {c.path}
              {c.conflict && <Chip size="small" color="warning" label="⚠ ไฟล์จริงถูกแก้" className="!h-5 !text-[11px] !font-extrabold" />}
            </div>
          </AccordionSummary>
          <AccordionDetails className="!px-0 !pt-0">
            <pre className="m-0 max-h-80 overflow-auto whitespace-pre rounded-[10px] bg-[#1b1747] p-2.5 font-mono text-xs leading-normal text-[#e7e5ff]">
              {c.diff.split('\n').map((l, i) => (
                <div key={i} className={'min-h-[1.5em] ' + (l.startsWith('+') ? 'bg-green-500/25' : l.startsWith('-') ? 'bg-red-500/25' : l.startsWith('…') ? 'text-[#9d99d6]' : '')}>{l || ' '}</div>
              ))}
            </pre>
          </AccordionDetails>
        </Accordion>
      ))}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>นำไปใช้กับโปรเจกต์จริง?</DialogTitle>
        <DialogContent>
          <DialogContentText className="!break-all !font-semibold">{data.target}</DialogContentText>
          <DialogContentText className="!mt-2">ไฟล์เดิมจะถูกสำรองไว้ใน <code>.ai-office-backup/</code> ให้อัตโนมัติ</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setConfirmOpen(false)}>ยกเลิก</Button>
          <Button variant="contained" color="success" onClick={apply}>ยืนยัน นำไปใช้</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
