// ฉากออฟฟิศ isometric แบบ CSS 3D (พื้น ผนัง ห้อง โต๊ะ ต้นไม้ ฯลฯ) — สร้างเป็น HTML string ครั้งเดียว
// พิกัดพื้น (plane) อยู่ในช่วง −440…440 ศูนย์กลาง (0,0) · พื้นวางที่ (CX, CY) ในกรอบออกแบบ 1600×1000
export const CX = 600;
export const CY = 490;
const L = 440;

/** ฉาย (x, y, z) บนพื้นไปเป็นพิกัดจอ */
export const P = (x: number, y: number, z: number) => ({
  x: CX + (x - y) * 0.7071,
  y: CY + (x + y) * 0.35355 - z * 0.866,
});

const box = (x: number, y: number, w: number, h: number, z: number, bg: string, extra = '') =>
  `left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${bg};${extra}transform:translateZ(${z}px)`;

/** ห้อง PM: ชิดผนังซ้าย (แนวผนังฝั่งซ้ายบนของจอ) กว้าง w ลึก h */
export const PM = { x: -430, y: -430, w: 110, h: 200 };

export type Seat = [x: number, y: number, off: number];
/** ที่นั่งของพนักงานแต่ละคน: [x, y ของเก้าอี้, ±36 = โต๊ะอยู่หน้า/หลังเก้าอี้] */
export const SEATS: Record<string, Seat> = {
  pm: [-375, -400, 36], ds: [-145, -263, 36],
  fe1: [145, -149, -36], fe2: [255, -263, 36],
  be1: [-255, 57, -36], be2: [-145, -57, 36],
  qa1: [145, 57, -36], qa2: [255, -57, 36],
  ops: [-255, 263, -36], sec: [-145, 149, 36],
};

const benches = [
  { bx: -200, by: -206 }, { bx: 200, by: -206 },
  { bx: -200, by: 0 }, { bx: 200, by: 0 },
  { bx: -200, by: 206 },
];

function layers(list: string[]) {
  return list.map((s) => `<div class="pl" style="${s}"></div>`).join('');
}

export function buildSceneHtml() {
  const slab = ['#0b0824', '#120c33', '#1a1250', '#241a6b'];
  const floorLayers = [-12, -9, -6, -3].map((z, i) => box(-L, -L, L * 2, L * 2, z, slab[i]));

  const pathBase = 'border-color:#ff7a45;border-style:dashed;opacity:.85;transform:translateZ(2px);';
  const pathLines = [
    pathBase + 'left:-420px;top:-103px;width:840px;height:0;border-top-width:3px',
    pathBase + 'left:-420px;top:103px;width:840px;height:0;border-top-width:3px',
    pathBase + 'left:0;top:-420px;width:0;height:840px;border-left-width:3px',
  ];

  const props: string[] = [];
  // ผนังหลังพร้อมแถบหน้าต่าง
  for (let i = 0; i < 13; i++) {
    const c = i === 6 ? '#ff4fd8' : (i < 7 ? ['#1a1450', '#1f1860'][i % 2] : (i === 12 ? '#38e1ff' : ['#2a6fb5', '#3b82d0'][i % 2]));
    props.push(box(-L, -L - 8, L * 2, 8, i * 4, c));
    props.push(box(-L - 8, -L, 8, L * 2, i * 4, c));
  }
  // ตู้โทรศัพท์ (ย้ายมาชิดผนังหลัง ตรงช่องว่างกลางแถวบน)
  const podColors = ['#38e1ff', '#a855f7', '#ff9f43'];
  [-72, -36, 0].forEach((px, n) => {
    for (let i = 0; i < 20; i++) {
      const c = i >= 17 ? podColors[n] : ['#bdb9e6', '#cdc9f0'][i % 2];
      props.push(box(px - 18, -L + 6, 36, 36, i * 4, c));
    }
  });
  // ห้องประชุมกระจก
  props.push(box(44, -430, 356, 140, 1, '#5b47c9'));
  [0, 16, 32, 48, 64].forEach((z) => {
    props.push(box(44, -430, 356, 140, z, 'rgba(120,220,255,.07)', 'border:2px solid rgba(60,200,255,.8);'));
  });
  const mtShades = ['#8a87b8', '#a3a0c6', '#bab8da', '#f4f3ff'];
  [0, 3, 6, 9].forEach((z, i) => props.push(box(120, -385, 200, 50, z, mtShades[i])));
  [150, 200, 250, 290].forEach((x) => {
    [-398, -322].forEach((y) => {
      [0, 3, 6].forEach((z) => props.push(box(x - 7, y - 7, 14, 14, z, z === 6 ? '#4b46a0' : '#2e2b5a')));
    });
  });
  // ห้องกระจกส่วนตัวของ PM — อยู่บนสุด (มุมบนซ้าย ชิดผนังซ้ายและผนังหลัง)
  props.push(box(PM.x, PM.y, PM.w, PM.h, 1, '#6b4fc9'));
  [0, 16, 32, 48, 64].forEach((z) => {
    props.push(box(PM.x, PM.y, PM.w, PM.h, z, 'rgba(255,200,120,.07)', 'border:2px solid rgba(255,190,100,.85);'));
  });
  [PM.x + 30, PM.x + 72].forEach((x) => {
    [0, 3, 6].forEach((z) => props.push(box(x - 8, PM.y + 138, 16, 16, z, z === 6 ? '#4b46a0' : '#2e2b5a')));
  });
  [0, 3].forEach((z) => props.push(box(PM.x + 86, PM.y + 168, 18, 18, z, '#8a5a3c')));
  ['#2f9d58', '#38b266', '#42c673', '#5be39a'].forEach((c, i) => props.push(box(PM.x + 83, PM.y + 165, 24, 24, 6 + i * 3, c)));
  // เลานจ์
  props.push(box(-300, -410, 200, 120, 1, '#6a56d6'));
  [3, 6, 9, 12].forEach((z) => props.push(box(-280, -400, 110, 34, z, '#7c3aed')));
  [3, 6, 9, 12, 15, 18, 21, 24].forEach((z) => props.push(box(-280, -408, 110, 8, z, '#6d28d9')));
  [0, 3, 6].forEach((z) => props.push(box(-240, -350, 44, 32, z, '#f1f0ff')));
  // โต๊ะ Team Sync
  const tableShades = ['#8a87b8', '#a3a0c6', '#bab8da', '#1b9bc6'];
  [0, 3, 6, 9].forEach((z, i) => {
    props.push(box(-50, 73, 100, 60, z, tableShades[i], i === 3 ? 'border:2px solid #38e1ff;box-shadow:0 0 16px #38e1ff;' : ''));
  });
  // ตู้เซิร์ฟเวอร์
  [120, 160, 200, 240].forEach((rx) => {
    for (let i = 0; i < 11; i++) props.push(box(rx - 14, 192, 28, 28, i * 4, i === 10 ? '#38e1ff' : ['#1f2147', '#2a2d5e'][i % 2]));
  });
  // ชั้นหนังสือ
  const bookC = ['#e24a6a', '#4a7be2', '#f2b84a', '#4ac28a', '#b05ae2'];
  for (let i = 0; i < 15; i++) {
    props.push(box(-310, -L + 8, 230, 14, i * 4, bookC[i % 5]));
  }
  // ต้นไม้ในทางเดิน
  const leafShades = ['#2f9d58', '#38b266', '#42c673', '#5be39a'];
  [[-300, -103], [300, -103], [-300, 103], [300, 103]].forEach((q) => {
    [0, 3].forEach((z) => props.push(box(q[0] - 9, q[1] - 9, 18, 18, z, '#8a5a3c')));
    [6, 9, 12, 15].forEach((z, i) => props.push(box(q[0] - 12, q[1] - 12, 24, 24, z, leafShades[i])));
  });

  // โต๊ะยาว 2 แถวหันหลังชนกัน
  const deskShades = ['#8d8abf', '#a09dcc', '#ffffff'];
  const desks: string[] = [];
  const addDesk = (dx: number, dy: number, row: 1 | 2) => {
    [0, 5, 10].forEach((z, k) => desks.push(box(dx - 55, dy - 21, 110, 42, z, deskShades[k], k === 2 ? 'border:1px solid #cfcdf0;' : '')));
    desks.push(box(dx - 12, row === 1 ? dy - 12 : dy + 4, 24, 8, 11, '#4a4780'));
    [-32, 10].forEach((mx, m) => {
      [12, 16, 20].forEach((z, i) => {
        let c: string;
        if (row === 2) c = i < 2 ? (m === 0 ? ['#2f6fe0', '#4a86f0'][i % 2] : ['#c03fd9', '#d95cf0'][i % 2]) : '#12123a';
        else c = i < 2 ? ['#2e2b5a', '#3b3870'][i % 2] : (m === 0 ? '#3b82f6' : '#d946ef');
        desks.push(box(dx + mx, row === 1 ? dy + 12 : dy - 17, 30, 5, z, c));
      });
    });
  };
  const addChair = (x: number, y: number) => {
    [0, 3, 6].forEach((z) => desks.push(box(x - 11, y - 11, 22, 22, z, '#2e2b5a')));
    desks.push(box(x - 11, y - 11, 22, 22, 9, '#4b46a0'));
  };
  benches.forEach((b) => {
    [-55, 55].forEach((o) => {
      const x = b.bx + o;
      addDesk(x, b.by - 21, 1); addChair(x, b.by - 57);
      addDesk(x, b.by + 21, 2); addChair(x, b.by + 57);
    });
    [-136, 136].forEach((o) => {
      [0, 3, 6, 9].forEach((z) => desks.push(box(b.bx + o - 20, b.by - 50, 40, 100, z, z === 9 ? '#cfcdf0' : '#e5e3fa')));
      [12, 15, 18, 21].forEach((z, i) => desks.push(box(b.bx + o - 15, b.by - 42, 30, 84, z, leafShades[i])));
    });
  });
  addDesk(PM.x + 55, PM.y + 66, 1);
  addChair(PM.x + 55, PM.y + 30);

  return {
    floor: layers(floorLayers) + layers(pathLines),
    props: layers(props),
    desks: layers(desks),
  };
}
