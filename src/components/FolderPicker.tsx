'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Breadcrumbs, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  InputAdornment, Link, List, ListItemButton, ListItemIcon, ListItemText, TextField, Typography,
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import FolderSpecialIcon from '@mui/icons-material/FolderSpecial';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';

interface Listing {
  root: string; current: string; abs: string; parent: string | null;
  dirs: { name: string; rel: string; isProject: boolean }[];
}

interface Props {
  open: boolean;
  /** โหมดสร้างใหม่: เปิดให้สร้างโฟลเดอร์ใหม่ในหน้าต่างนี้ได้ */
  allowCreate: boolean;
  initial: string;
  onClose: () => void;
  onPick: (rel: string) => void;
}

export default function FolderPicker({ open, allowCreate, initial, onClose, onPick }: Props) {
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');

  const load = useCallback(async (rel: string) => {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/browse?path=' + encodeURIComponent(rel));
      const j = (await r.json()) as Listing & { error?: string };
      if (!r.ok) throw new Error(j.error ?? 'เปิดโฟลเดอร์ไม่ได้');
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เปิดโฟลเดอร์ไม่ได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setNewName('');
    void load(initial).then(() => undefined);
  }, [open, initial, load]);

  // ถ้า path เดิมที่เลือกไว้ใช้ไม่ได้ ให้ถอยกลับไปที่ root
  useEffect(() => { if (error && data === null && open && initial) void load(''); }, [error, data, open, initial, load]);

  async function createFolder() {
    if (!data || !newName.trim()) return;
    setError('');
    const r = await fetch('/api/browse', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parent: data.current, name: newName }),
    });
    const j = (await r.json()) as { rel?: string; error?: string };
    if (!r.ok || !j.rel) { setError(j.error ?? 'สร้างโฟลเดอร์ไม่สำเร็จ'); return; }
    onPick(j.rel);
  }

  const crumbs = data ? data.current.split('/').filter(Boolean) : [];
  const atRoot = !!data && data.current === '';

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle className="!font-display !pb-1">เลือกโฟลเดอร์โปรเจกต์</DialogTitle>
      <DialogContent dividers className="!px-4 !py-3">
        {data && (
          <div className="mb-2 flex items-center gap-1">
            <IconButton size="small" disabled={data.parent === null} onClick={() => data.parent !== null && load(data.parent)} aria-label="ขึ้นไปโฟลเดอร์แม่">
              <ArrowUpwardIcon fontSize="small" />
            </IconButton>
            <Breadcrumbs maxItems={4} className="!text-[13px]">
              <Link component="button" type="button" underline="hover" onClick={() => load('')} className="!font-bold">
                {data.root.split('/').filter(Boolean).pop() ?? 'root'}
              </Link>
              {crumbs.map((c, i) => (
                <Link key={i} component="button" type="button" underline="hover" onClick={() => load(crumbs.slice(0, i + 1).join('/'))}>{c}</Link>
              ))}
            </Breadcrumbs>
          </div>
        )}
        {error && <Alert severity="error" className="!mb-2">{error}</Alert>}
        {loading && !data && <div className="flex justify-center p-6"><CircularProgress size={28} /></div>}
        {data && (
          <List dense disablePadding className="max-h-[42dvh] overflow-auto rounded-xl border-2 border-line bg-card2">
            {data.dirs.length === 0 && <Typography color="text.secondary" className="!p-4 !text-center !text-sm">ไม่มีโฟลเดอร์ย่อย</Typography>}
            {data.dirs.map((d) => (
              <ListItemButton key={d.rel} onClick={() => load(d.rel)} onDoubleClick={() => onPick(d.rel)}>
                <ListItemIcon className="!min-w-9">{d.isProject ? <FolderSpecialIcon color="primary" /> : <FolderIcon className="!text-[#9d99d6]" />}</ListItemIcon>
                <ListItemText primary={d.name} slotProps={{ primary: { className: '!font-semibold' } }} />
                {d.isProject && <Chip size="small" label="โปรเจกต์" color="primary" variant="outlined" className="!h-5 !text-[11px]" />}
              </ListItemButton>
            ))}
          </List>
        )}
        <Typography variant="caption" color="text.secondary" className="!mt-1.5 !block">
          คลิกเพื่อเปิดโฟลเดอร์ย่อย · ดับเบิลคลิกเพื่อเลือกทันที · อนุญาตเฉพาะโฟลเดอร์ใต้ <code>{data?.root ?? '…'}</code>
        </Typography>
        {allowCreate && data && (
          <TextField
            size="small" fullWidth className="!mt-3" label={`สร้างโฟลเดอร์ใหม่ใน "${data.current || 'root'}"`} value={newName}
            onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void createFolder(); } }}
            slotProps={{ input: { endAdornment: (
              <InputAdornment position="end">
                <Button size="small" startIcon={<CreateNewFolderIcon />} disabled={!newName.trim()} onClick={createFolder}>สร้างและเลือก</Button>
              </InputAdornment>
            ) } }}
          />
        )}
      </DialogContent>
      <DialogActions className="!px-4 !py-2.5">
        <Typography variant="body2" color="text.secondary" className="!mr-auto !truncate">{data ? (atRoot ? 'โฟลเดอร์แม่สุด เลือกไม่ได้' : data.current) : ''}</Typography>
        <Button color="inherit" onClick={onClose}>ยกเลิก</Button>
        <Button variant="contained" disabled={!data || atRoot} onClick={() => data && onPick(data.current)}>เลือกโฟลเดอร์นี้</Button>
      </DialogActions>
    </Dialog>
  );
}
