/** Generates moody, abstract "bar photographs" on a canvas, so demo data needs no image files. Dev tools only. */
function rng(seed: number) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

const PALETTES: [number, number][] = [
  [345, 40], [28, 55], [12, 50], [160, 25], [40, 60], [320, 30], [200, 25], [5, 60],
];

export function makeDemoPhoto(seed: number): Promise<Blob> {
  const r = rng(seed + 3);
  const [hue, sat] = PALETTES[seed % PALETTES.length];
  const w = 1200;
  const h = 1500;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, w * 0.4, h);
  bg.addColorStop(0, `hsl(${hue} ${sat}% 14%)`);
  bg.addColorStop(1, `hsl(${hue + 20} ${sat}% 5%)`);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) {
    const x = r() * w;
    const y = r() * h * 0.7;
    const rad = 40 + r() * 140;
    const light = 30 + r() * 40;
    const rg = g.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, `hsla(${hue + r() * 40} ${sat + 20}% ${light}% / ${0.25 + r() * 0.35})`);
    rg.addColorStop(1, `hsla(${hue} ${sat}% ${light}% / 0)`);
    g.fillStyle = rg;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  // a glowing glass
  const cx = w * (0.4 + r() * 0.2);
  const gl = g.createLinearGradient(cx - 150, h * 0.62, cx + 150, h * 0.9);
  gl.addColorStop(0, `hsla(${hue + 10} 70% 55% / 0.95)`);
  gl.addColorStop(1, `hsla(${hue} 80% 25% / 0.95)`);
  g.fillStyle = gl;
  g.beginPath();
  g.moveTo(cx - 190, h * 0.6);
  g.lineTo(cx + 190, h * 0.6);
  g.lineTo(cx + 30, h * 0.8);
  g.lineTo(cx - 30, h * 0.8);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(243,237,228,.55)';
  g.fillRect(cx - 5, h * 0.8, 10, h * 0.11);
  g.fillRect(cx - 110, h * 0.91, 220, 8);
  const v = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.85);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,.6)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.9));
}
