import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchPosts,     buildBlogSlide    } from './blogs.js';
import { fetchPodcasts,  buildPodcastSlide } from './podcasts.js';
import config from '../config.json' with { type: 'json' };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ───────────────────────────────────────────────────────────────────

const { logoUrl: LOGO_URL, enableSound: ENABLE_SOUND } = config.display;

if (!process.env.GHOST_CONTENT_API_KEY) {
  console.error('Error: GHOST_CONTENT_API_KEY is required');
  process.exit(1);
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

// ─── Shell ────────────────────────────────────────────────────────────────────

function buildDots(items) {
  let html = '';
  let prevType = null;
  items.forEach((item, i) => {
    if (prevType !== null && item._type !== prevType) {
      html += '      <div class="dot-sep"></div>\n';
    }
    html += `      <div class="dot dot-${item._type}${i === 0 ? ' active' : ''}"></div>\n`;
    prevType = item._type;
  });
  return html;
}

function buildHTML({ logoTag, slidesHtml, dotsHtml, enableSound }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="1800">
  <meta name="viewport" content="width=1080, height=1920, initial-scale=1.0">
  <title>Inovus Labs - Kiosk Display</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>

  <div class="screen-guard">
    <div class="screen-guard-icon"></div>
    <div class="screen-guard-eyebrow">Welcome to Inovus Labs - Kiosk Display</div>
    <div class="screen-guard-title">You're on the right page, but wrong screen</div>
    <div class="screen-guard-body">
      This is a custom-built kiosk display designed to be displayed on a 1080 &times; 1920 TV screen in portrait orientation.
    </div>
    <div class="screen-guard-url">blog.inovuslabs.org</div>
  </div>

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
  const SRC_DIR  = path.join(__dirname, '..', 'src');
  const OUT_DIR  = path.join(__dirname, '..', 'out');
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // Copy static assets
  fs.copyFileSync(path.join(SRC_DIR, 'style.css'), path.join(OUT_DIR, 'style.css'));
  fs.copyFileSync(path.join(SRC_DIR, 'app.js'),    path.join(OUT_DIR, 'app.js'));
  fs.copyFileSync(path.join(SRC_DIR, 'wave.svg'),  path.join(OUT_DIR, 'wave.svg'));
  if (ENABLE_SOUND) {
    fs.copyFileSync(path.join(SRC_DIR, 'audio.js'), path.join(OUT_DIR, 'audio.js'));
  }
  console.log(`Copied style.css, app.js, wave.svg${ENABLE_SOUND ? ' and audio.js' : ' (sound disabled)'}`);

  // Fetch blog posts
  let posts = [];
  if (config.ghost.enable) {
    console.log('Fetching posts\u2026');
    posts = await fetchPosts();
    console.log(`Fetched ${posts.length} posts`);
  } else {
    console.log('Blogs disabled in config.json, skipping');
  }

  // Fetch podcast episodes
  let podcastShow     = null;
  let podcastEpisodes = [];
  if (config.podcast.enable) {
    console.log('Fetching podcast RSS\u2026');
    try {
      ({ show: podcastShow, episodes: podcastEpisodes } = await fetchPodcasts());
      console.log(`Fetched ${podcastEpisodes.length} podcast episodes`);
    } catch (e) {
      console.warn('Podcast RSS fetch failed:', e.message);
    }
  } else {
    console.log('Podcasts disabled in config.json, skipping');
  }

  // Group by type (date-sorted within each group), blogs first then podcasts
  const blogItems    = posts.map(p => ({ ...p, _type: 'blog',    _date: new Date(p.published_at) }))
                            .sort((a, b) => b._date - a._date);
  const podcastItems = podcastEpisodes.map(e => ({ ...e, _type: 'podcast', _date: new Date(e.release_date) }))
                                      .sort((a, b) => b._date - a._date);
  const allItems = [...blogItems, ...podcastItems];

  console.log('Fetching logo\u2026');
  const logoSrc = await fetchLogo();
  const logoTag = logoSrc
    ? `<img class="logo" src="${logoSrc}" alt="Inovus Labs">`
    : `<span class="logo-fallback">Inovus Labs</span>`;

  // Build slides
  let slidesHtml, dotsHtml;
  if (allItems.length === 0) {
    slidesHtml = '    <div class="slide active" data-accent="#6C63FF"><div class="empty"><div class="empty-text">No content yet \u2014 check back soon</div></div></div>';
    dotsHtml   = '      <div class="dot active"></div>';
  } else {
    const built = await Promise.all(allItems.map((item, i) =>
      item._type === 'podcast'
        ? buildPodcastSlide(item, podcastShow, i)
        : buildBlogSlide(item, i)
    ));
    slidesHtml = built.join('');
    dotsHtml   = buildDots(allItems);
  }

  // Write HTML
  const html     = buildHTML({ logoTag, slidesHtml, dotsHtml, enableSound: ENABLE_SOUND });
  const htmlPath = path.join(OUT_DIR, 'index.html');
  fs.writeFileSync(htmlPath, html, 'utf8');

  const rootCnamePath = path.join(ROOT_DIR, 'CNAME');
  const outCnamePath  = path.join(OUT_DIR,  'CNAME');
  if (fs.existsSync(rootCnamePath)) {
    fs.copyFileSync(rootCnamePath, outCnamePath);
    console.log('Copied CNAME to out/');
  } else if (fs.existsSync(outCnamePath)) {
    fs.unlinkSync(outCnamePath);
    console.log('Removed out/CNAME');
  }

  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log(`Written out/index.html  (${kb} KB, ${allItems.length} slides: ${posts.length} blog, ${podcastEpisodes.length} podcast)`);
  console.log(`Output: ${OUT_DIR}`);
}

try {
  await main();
} catch (err) {
  console.error('Build failed:', err.message || err);
  process.exit(1);
}
