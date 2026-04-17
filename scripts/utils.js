import QRCode from 'qrcode';

// ─── Script detection ─────────────────────────────────────────────────────────

export function hasMalayalam(str) {
  return /[\u0D00-\u0D7F]/.test(str || '');
}

// ─── Color ────────────────────────────────────────────────────────────────────

export function hexToRgb(hex) {
  const c = (hex || '').replace('#', '');
  if (c.length !== 6) return { r: 108, g: 99, b: 255 };
  return {
    r: parseInt(c.slice(0, 2), 16),
    g: parseInt(c.slice(2, 4), 16),
    b: parseInt(c.slice(4, 6), 16),
  };
}

// ─── Strings ──────────────────────────────────────────────────────────────────

export function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch (_) { return ''; }
}

export function esc(str) {
  return (str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function truncate(str, max) {
  if (!str) return '';
  const s = str.replace(/<[^>]*>/g, '').trim();
  return s.length <= max ? s : s.slice(0, max).trimEnd() + '\u2026';
}

export function formatDuration(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function getInitials(name) {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return p.length === 1
    ? p[0].slice(0, 2).toUpperCase()
    : (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

export function svgAvatar(name, accent) {
  const { r, g, b } = hexToRgb(accent);
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">',
    `<rect width="72" height="72" rx="36" fill="rgb(${r},${g},${b})"/>`,
    '<text x="36" y="36" dy="0.35em" text-anchor="middle" ',
    'font-family="Plus Jakarta Sans,Arial,sans-serif" font-size="26" font-weight="800" fill="white">',
    esc(getInitials(name)),
    '</text></svg>',
  ].join('');
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

// ─── QR ───────────────────────────────────────────────────────────────────────

function withUtm(url) {
  const u = new URL(url);
  u.searchParams.set('utm_source', 'kiosk');
  u.searchParams.set('utm_medium', 'display');
  u.searchParams.set('utm_campaign', 'inovuslabs');
  return u.toString();
}

export async function makeQR(url) {
  return QRCode.toDataURL(withUtm(url), {
    width: 188, margin: 2,
    color: { dark: '#111111', light: '#ffffff' },
  });
}
