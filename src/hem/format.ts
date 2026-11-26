export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const kr = (n: number) => `${Math.round(n).toLocaleString('sv-SE')} kr`;

export const num = (v: string) => {
  const x = parseFloat(v.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(x) ? x : 0;
};

export const dec = (n: number) => (n ? n.toLocaleString('sv-SE', { maximumFractionDigits: 2 }) : '');

export function dateSv(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Dagar kvar till ett datum (negativt = passerat). */
export function daysLeft(iso: string): number | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

/** Förminskar en bild så att den får plats i webbläsarens lagring. */
export function shrinkImage(file: Blob, max = 1280, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * s));
      c.height = Math.max(1, Math.round(img.height * s));
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Bilden gick inte att läsa'));
    };
    img.src = url;
  });
}
