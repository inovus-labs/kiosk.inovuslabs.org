import fs       from 'fs';
import path     from 'path';
import { fileURLToPath } from 'url';
import QRCode   from 'qrcode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ───────────────────────────────────────────────────────────────────

const GHOST_API_URL         = process.env.GHOST_API_URL || 'https://blog.inovuslabs.org';
const GHOST_CONTENT_API_KEY = process.env.GHOST_CONTENT_API_KEY;
const ENABLE_SOUND          = process.env.ENABLE_SOUND !== 'false';
const LOGO_URL              = 'https://inovuslabs.org/assets/logo.svg';
const POST_LIMIT            = 8;

if (!GHOST_CONTENT_API_KEY) {
  console.error('Error: GHOST_CONTENT_API_KEY is required');
  process.exit(1);
}

// ─── Ghost API ────────────────────────────────────────────────────────────────

async function fetchPosts() {
  const url =
    `${GHOST_API_URL}/ghost/api/content/posts/` +
    `?key=${GHOST_CONTENT_API_KEY}` +
    `&limit=${POST_LIMIT}` +
    `&fields=title,custom_excerpt,excerpt,feature_image,published_at,url,reading_time` +
    `&include=tags,authors`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ghost API returned ${res.status}`);
  const data = await res.json();
  return data.posts || [];
}

// ─── Logo ─────────────────────────────────────────────────────────────────────

async function fetchLogo() {
  try {
    const res = await fetch(LOGO_URL);
    if (!res.ok) return null;
    const svg = await res.text();
    // Swap dark fills to white so logo reads on dark cover image
    const white = svg
      .replace(/fill="#263238"/g, 'fill="#FFFFFF"')
      .replace(/fill="#37474F"/g, 'fill="#FFFFFF"')
      .replace(/fill="#455A64"/g, 'fill="#FFFFFF"');
    return 'data:image/svg+xml;base64,' + Buffer.from(white).toString('base64');
  } catch (e) {
    console.warn('Logo fetch failed:', e.message);
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const c = (hex || '').replace('#', '');
  if (c.length !== 6) return { r: 108, g: 99, b: 255 };
  return {
    r: parseInt(c.slice(0, 2), 16),
    g: parseInt(c.slice(2, 4), 16),
    b: parseInt(c.slice(4, 6), 16),
  };
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch (_) { return ''; }
}

function esc(str) {
  return (str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function truncate(str, max) {
  if (!str) return '';
  const s = str.replace(/<[^>]*>/g, '').trim();
  return s.length <= max ? s : s.slice(0, max).trimEnd() + '\u2026';
}

function getInitials(name) {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return p.length === 1
    ? p[0].slice(0, 2).toUpperCase()
    : (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

function svgAvatar(name, accent) {
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

function withUtm(url) {
  const u = new URL(url);
  u.searchParams.set('utm_source', 'kiosk');
  u.searchParams.set('utm_medium', 'display');
  u.searchParams.set('utm_campaign', 'inovuslabs');
  return u.toString();
}

async function makeQR(url) {
  return QRCode.toDataURL(withUtm(url), {
    width: 188, margin: 2,
    color: { dark: '#111111', light: '#ffffff' },
  });
}

// ─── Slide HTML ───────────────────────────────────────────────────────────────

async function buildSlide(post, index) {
  const tag    = post.tags?.[0]    ?? null;
  const author = post.authors?.[0] ?? null;

  const accent = tag?.accent_color ?? '#6C63FF';
  const { r, g, b } = hexToRgb(accent); // used for QR card border

  const qr         = await makeQR(post.url);
  const title      = esc(post.title || 'Untitled');
  const excerpt    = esc(truncate(post.custom_excerpt || post.excerpt, 145));
  const authorName = esc(author?.name ?? 'Inovus Labs');
  const dateStr    = formatDate(post.published_at);
  const mins       = post.reading_time || 1;

  const avatarSrc = author?.profile_image ?? svgAvatar(authorName, accent);
  const avatarFb  = svgAvatar(authorName, accent);

  const coverStyle = post.feature_image
    ? `background-image:url('${post.feature_image}');background-size:cover;background-position:center top;`
    : `background:linear-gradient(148deg,${accent} 0%,#0a0a0a 65%);`;

  return `
    <div class="slide${index === 0 ? ' active' : ''}" data-accent="${accent}">

      <div class="cover" style="${coverStyle}"></div>
      <div class="cover-fade"></div>

      <div class="content">

        ${tag ? `<div><span class="tag-badge" style="background:${accent};">${esc(tag.name)}</span></div>` : ''}

        <h1 class="title">${title}</h1>
        <p class="excerpt">${excerpt}</p>

        <div class="author-row">
          <img class="author-av" src="${avatarSrc}" alt="${authorName}"
               onerror="this.onerror=null;this.src='${avatarFb}'">
          <div class="author-info">
            <span class="author-name">${authorName}</span>
            <span class="author-meta">${mins}&nbsp;min&nbsp;read&nbsp;&nbsp;&middot;&nbsp;&nbsp;${dateStr}</span>
          </div>
        </div>

        <div class="qr-card" style="border-color:rgba(${r},${g},${b},0.24);background:linear-gradient(135deg,rgba(255,255,255,0.14) 0%,rgba(255,255,255,0.05) 100%);">
          <div class="qr-code-wrap">
            <img class="qr-img" src="${qr}" alt="QR code">
          </div>
          <div class="qr-text">
            <div class="qr-kicker" style="color:${accent};">SCAN TO READ</div>
            <div class="qr-cta">Continue this blog on your phone</div>
            <div class="qr-url">blog.inovuslabs.org</div>
          </div>
        </div>

      </div>
    </div>`;
}

function buildDots(count) {
  return Array.from({ length: count }, (_, i) =>
    `      <div class="dot${i === 0 ? ' active' : ''}"></div>`
  ).join('\n');
}

// ─── HTML shell ───────────────────────────────────────────────────────────────

function buildHTML({ logoTag, slidesHtml, dotsHtml, enableSound }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="1800">
  <meta name="viewport" content="width=1080, height=1920, initial-scale=1.0">
  <title>Inovus Labs Blog</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>

  <div class="header">
    ${logoTag}
    <div class="clock" id="clock">--:--</div>
  </div>

  <div class="top-shade"></div>

  <div class="slideshow">
${slidesHtml}
  </div>

  <div class="dots-bar">
    <div class="dots">
${dotsHtml}
    </div>
  </div>

  <div class="progress-line" id="progress-line"></div>

  <script src="app.js"></script>
  ${enableSound ? '<script src="audio.js"></script>' : ''}

</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const ROOT_DIR = path.join(__dirname, '..');
  const SRC_DIR = path.join(__dirname, '..', 'src');
  const OUT_DIR = path.join(__dirname, '..', 'out');
  const rootCnamePath = path.join(ROOT_DIR, 'CNAME');
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // Copy static assets
  fs.copyFileSync(path.join(SRC_DIR, 'style.css'), path.join(OUT_DIR, 'style.css'));
  fs.copyFileSync(path.join(SRC_DIR, 'app.js'),    path.join(OUT_DIR, 'app.js'));
  if (ENABLE_SOUND) {
    fs.copyFileSync(path.join(SRC_DIR, 'audio.js'), path.join(OUT_DIR, 'audio.js'));
  }
  console.log(`Copied style.css and app.js${ENABLE_SOUND ? ' and audio.js' : ' (sound disabled)'}`);

  // Fetch data
  console.log('Fetching posts\u2026');
  const posts = await fetchPosts();
  console.log(`Fetched ${posts.length} posts`);

  console.log('Fetching logo\u2026');
  const logoSrc = await fetchLogo();
  const logoTag = logoSrc
    ? `<img class="logo" src="${logoSrc}" alt="Inovus Labs">`
    : `<span class="logo-fallback">Inovus Labs</span>`;

  // Build slides
  let slidesHtml, dotsHtml;
  if (posts.length === 0) {
    slidesHtml = '    <div class="slide active" data-accent="#6C63FF"><div class="empty"><div class="empty-text">No posts yet \u2014 check back soon</div></div></div>';
    dotsHtml   = '      <div class="dot active"></div>';
  } else {
    const built = await Promise.all(posts.map((p, i) => buildSlide(p, i)));
    slidesHtml  = built.join('');
    dotsHtml    = buildDots(posts.length);
  }

  // Write HTML
  const html     = buildHTML({ logoTag, slidesHtml, dotsHtml, enableSound: ENABLE_SOUND });
  const htmlPath = path.join(OUT_DIR, 'index.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  const cnamePath = path.join(OUT_DIR, 'CNAME');
  if (fs.existsSync(rootCnamePath)) {
    fs.copyFileSync(rootCnamePath, cnamePath);
    console.log('Copied CNAME to out/');
  } else if (fs.existsSync(cnamePath)) {
    fs.unlinkSync(cnamePath);
    console.log('Removed out/CNAME');
  }

  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log(`Written out/index.html  (${kb} KB, ${posts.length} slides)`);
  console.log(`Output: ${OUT_DIR}`);
}

try {
  await main();
} catch (err) {
  console.error('Build failed:', err.message || err);
  process.exit(1);
}
