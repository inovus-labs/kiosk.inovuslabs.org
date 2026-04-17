import { hexToRgb, formatDate, esc, truncate, svgAvatar, makeQR, hasMalayalam } from './utils.js';
import config from '../config.json' with { type: 'json' };

const GHOST_CONTENT_API_KEY = process.env.GHOST_CONTENT_API_KEY;
const { apiUrl: GHOST_API_URL, postLimit: POST_LIMIT } = config.ghost;

// ─── Fetch ────────────────────────────────────────────────────────────────────

export async function fetchPosts() {
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

// ─── Slide ────────────────────────────────────────────────────────────────────

export async function buildBlogSlide(post, index) {
  const tag    = post.tags?.[0]    ?? null;
  const author = post.authors?.[0] ?? null;

  const accent      = tag?.accent_color ?? '#6C63FF';
  const { r, g, b } = hexToRgb(accent);

  const qr         = await makeQR(post.url);
  const rawTitle   = post.title || 'Untitled';
  const rawExcerpt = truncate(post.custom_excerpt || post.excerpt, 145);
  const title      = esc(rawTitle);
  const excerpt    = esc(rawExcerpt);
  const titleMl    = hasMalayalam(rawTitle);
  const excerptMl  = hasMalayalam(rawExcerpt);
  const authorName = esc(author?.name ?? 'Inovus Labs');
  const dateStr    = formatDate(post.published_at);
  const mins       = post.reading_time || 1;

  const avatarSrc  = author?.profile_image ?? svgAvatar(authorName, accent);
  const avatarFb   = svgAvatar(authorName, accent);

  const coverStyle = post.feature_image
    ? `background-image:url('${post.feature_image}');background-size:cover;background-position:center top;`
    : `background:linear-gradient(148deg,${accent} 0%,#0a0a0a 65%);`;

  return `
    <div class="slide${index === 0 ? ' active' : ''}" data-accent="${accent}">

      <div class="cover" style="${coverStyle}"></div>
      <div class="cover-fade"></div>

      <div class="content">

        ${tag ? `<div><span class="tag-badge" style="background:${accent};">${esc(tag.name)}</span></div>` : ''}

        <h1 class="title${titleMl ? ' lang-ml' : ''}">${title}</h1>
        <p class="excerpt${excerptMl ? ' lang-ml' : ''}">${excerpt}</p>

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
