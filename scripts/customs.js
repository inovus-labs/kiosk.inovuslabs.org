import { esc, hasMalayalam } from './utils.js';
import config from '../config.json' with { type: 'json' };

const { apiUrl: CMS_API_URL, limit: CMS_LIMIT } = config.cms;
const DEFAULT_ACCENT = '#6C63FF';

// ─── Fetch ────────────────────────────────────────────────────────────────────

export async function fetchCustomSlides() {
  if (!CMS_API_URL) return [];

  const now = new Date();
  // +90s look-ahead: the build itself takes 60–120s, so a slide whose publishAt
  // falls inside that window should still be picked up by this build.
  const nowPlus90s = new Date(now.getTime() + 90_000).toISOString();
  const nowIso = now.toISOString();

  const params = new URLSearchParams();
  params.set('where[status][equals]', 'published');
  params.set('where[publishAt][less_than_equal]', nowPlus90s);
  params.set('where[or][0][expiresAt][exists]', 'false');
  params.set('where[or][1][expiresAt][greater_than]', nowIso);
  params.set('sort', 'pinnedOrder,-publishAt');
  // depth=1 needed to populate media.url; user-object fields are blocked at the
  // Users collection's access.read, not here.
  params.set('depth', '1');
  params.set('limit', String(CMS_LIMIT || 10));

  const url = `${CMS_API_URL}/api/slides?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Payload /api/slides returned ${res.status}`);
  }
  const data = await res.json();
  return data.docs || [];
}

// ─── Slide ────────────────────────────────────────────────────────────────────

export function buildImageSlide(slide, index) {
  const mediaUrl = slide.media?.url;
  if (!mediaUrl) {
    return buildTextSlide({ ...slide, type: 'text' }, index);
  }
  const url = esc(mediaUrl);
  const bgStyle = `background-image:url('${url}');background-size:cover;background-position:center center;`;
  return `
    <div class="slide slide-image${index === 0 ? ' active' : ''}" data-accent="${DEFAULT_ACCENT}">
      <div class="cover" style="${bgStyle}"></div>
      <img class="cover-photo" src="${url}" alt="">
    </div>`;
}

// Per-theme progress-bar / dot accent (palette colours live in style.css).
const THEME_ACCENTS = {
  midnight: '#4E78C8',
  slate:    '#8A99AD',
  emerald:  '#2A9D78',
  bordeaux: '#B85C7E',
};

export function buildTextSlide(slide, index) {
  const rawTitle = slide.title || '';
  const rawBody  = slide.body  || '';
  const title    = esc(rawTitle);
  const body     = esc(rawBody);
  const titleMl  = hasMalayalam(rawTitle);
  const bodyMl   = hasMalayalam(rawBody);
  const theme    = THEME_ACCENTS[slide.theme] ? slide.theme : 'midnight';
  const accent   = THEME_ACCENTS[theme];
  return `
    <div class="slide slide-text theme-${theme}${index === 0 ? ' active' : ''}" data-accent="${accent}">
      <div class="billboard-grain"></div>
      <div class="billboard-inner">
        <div class="billboard-headline${titleMl ? ' lang-ml' : ''}">${title}</div>
${body ? `        <div class="billboard-body${bodyMl ? ' lang-ml' : ''}">${body}</div>` : ''}
      </div>
    </div>`;
}

export function buildCustomSlide(slide, index) {
  if (slide.type === 'image') return buildImageSlide(slide, index);
  return buildTextSlide(slide, index);
}
