import fs   from 'fs';
import path from 'path';
import { esc, hasMalayalam } from './utils.js';
import config from '../config.json' with { type: 'json' };

const { apiUrl: CMS_API_URL, limit: CMS_LIMIT } = config.cms;
const DEFAULT_ACCENT = '#6C63FF';

// ─── Fetch ────────────────────────────────────────────────────────────────────

// Live slides, already filtered (published, not expired) and ordered
// (pinned first, then newest) by the kiosk-worker's /api/slides.json.
export async function fetchCustomSlides(outDir) {
  if (!CMS_API_URL) return [];

  const res = await fetch(`${CMS_API_URL}/api/slides.json?limit=${CMS_LIMIT || 10}`);
  if (!res.ok) {
    throw new Error(`CMS /api/slides.json returned ${res.status}`);
  }
  const { slides } = await res.json();
  return Promise.all(slides.map(slide => bundleImage(slide, outDir)));
}

// Copy poster images into out/media/ so the deployed kiosk never depends on the CMS being up.
async function bundleImage(slide, outDir) {
  if (!slide.imageUrl) return slide;
  try {
    const res = await fetch(slide.imageUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const name = path.basename(new URL(slide.imageUrl).pathname);
    fs.mkdirSync(path.join(outDir, 'media'), { recursive: true });
    fs.writeFileSync(path.join(outDir, 'media', name), Buffer.from(await res.arrayBuffer()));
    return { ...slide, imageUrl: `media/${name}` };
  } catch (e) {
    console.warn(`Image download failed for "${slide.title}", using remote URL:`, e.message);
    return slide;
  }
}

// ─── Slide ────────────────────────────────────────────────────────────────────

export function buildImageSlide(slide, index) {
  const mediaUrl = slide.imageUrl;
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
