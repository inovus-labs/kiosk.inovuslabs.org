import { XMLParser } from 'fast-xml-parser';
import { hexToRgb, formatDate, formatDuration, esc, svgAvatar, makeQR, hasMalayalam } from './utils.js';
import config from '../config.json' with { type: 'json' };

const { rssUrl: PODCAST_RSS_URL, episodeLimit: PODCAST_LIMIT } = config.podcast;

// ─── RSS Parser ───────────────────────────────────────────────────────────────

const RSS_PARSER = new XMLParser({
  ignoreAttributes:    false,
  attributeNamePrefix: '@_',
  cdataPropName:       '__cdata',
  textNodeName:        '#text',
  parseAttributeValue: false,
});

function cdataStr(val) {
  if (!val) return '';
  return String(val?.['__cdata'] ?? val).trim();
}

function parseDuration(str) {
  if (!str) return 0;
  str = String(str).trim();
  if (/^\d+$/.test(str)) return parseInt(str) * 1000;
  const parts = str.split(':').map(Number);
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  return 0;
}

function parseRSS(xml) {
  const doc     = RSS_PARSER.parse(xml);
  const channel = doc?.rss?.channel ?? {};

  const showName   = cdataStr(channel.title) || 'INORA : The Inovus Radio';
  const showImgUrl = channel['itunes:image']?.['@_href'] ?? null;
  const show       = { name: showName, images: showImgUrl ? [{ url: showImgUrl }] : [] };

  const rawItems = Array.isArray(channel.item) ? channel.item : (channel.item ? [channel.item] : []);
  const episodes = rawItems.slice(0, PODCAST_LIMIT).map(item => {
    const desc    = cdataStr(item.description) || cdataStr(item['itunes:summary']) || '';
    const pubDate = cdataStr(item.pubDate) || '';
    const imgUrl  = item['itunes:image']?.['@_href'] ?? showImgUrl;
    return {
      name:          cdataStr(item.title) || 'Untitled Episode',
      description:   desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      release_date:  pubDate ? new Date(pubDate).toISOString().split('T')[0] : '',
      duration_ms:   parseDuration(item['itunes:duration']),
      images:        imgUrl ? [{ url: imgUrl }] : [],
      external_urls: { spotify: cdataStr(item.link) || '' },
    };
  });

  return { show, episodes };
}

// ─── Spotify URL resolution ───────────────────────────────────────────────────

async function buildSpotifyUrlMap(anyEpisodeUrl) {
  try {
    const res = await fetch(anyEpisodeUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    const html = await res.text();
    const map  = new Map();
    for (const [, title, encoded] of html.matchAll(/"title":"([^"]+)","spotifyUrl":"(https:[^"]+open\.spotify\.com[^"]+)"/g)) {
      map.set(title.trim(), JSON.parse('"' + encoded + '"'));
    }
    return map;
  } catch {
    return null;
  }
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

export async function fetchPodcasts() {
  const res = await fetch(PODCAST_RSS_URL);
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
  const { show, episodes } = parseRSS(await res.text());

  const firstUrl = episodes[0]?.external_urls.spotify;
  const urlMap   = firstUrl ? await buildSpotifyUrlMap(firstUrl) : null;

  const resolved = episodes.map(ep => {
    const spotifyUrl = urlMap?.get(ep.name.trim()) ?? ep.external_urls.spotify;
    return { ...ep, external_urls: { spotify: spotifyUrl } };
  });

  return { show, episodes: resolved };
}

// ─── Slide ────────────────────────────────────────────────────────────────────

export async function buildPodcastSlide(episode, show, index) {
  const accent      = '#1DB954';
  const { r, g, b } = hexToRgb(accent);

  const coverImage  = episode.images?.[0]?.url || show.images?.[0]?.url || null;
  const artFb       = svgAvatar(show.name || 'INORA', accent);
  const artSrc      = coverImage ?? artFb;

  const qr        = await makeQR(episode.external_urls.spotify);
  const rawTitle  = episode.name || 'Untitled Episode';
  const title     = esc(rawTitle);
  const titleMl   = hasMalayalam(rawTitle);
  const showName  = esc(show.name || 'Inovus Labs Podcast');
  const dateStr  = formatDate(episode.release_date);
  const duration = episode.duration_ms ? formatDuration(episode.duration_ms) : '\u2014';

  const bgStyle = coverImage
    ? `background-image:url('${coverImage}');`
    : `background:linear-gradient(148deg,${accent} 0%,#0a0a0a 65%);`;

  return `
    <div class="slide podcast${index === 0 ? ' active' : ''}" data-accent="${accent}">

      <div class="podcast-bg" style="${bgStyle}"></div>

      <div class="podcast-content">

        <div class="podcast-artwork-wrap">
          <img class="podcast-artwork" src="${artSrc}" alt="${showName}"
               onerror="this.onerror=null;this.src='${artFb}'">
        </div>

        <div class="podcast-eyebrow">Podcast</div>
        <h1 class="podcast-title${titleMl ? ' lang-ml' : ''}">${title}</h1>
        <div class="podcast-meta">${showName}&nbsp;&nbsp;&middot;&nbsp;&nbsp;${duration}&nbsp;listen&nbsp;&nbsp;&middot;&nbsp;&nbsp;${dateStr}</div>

        <div class="qr-card" style="border-color:rgba(${r},${g},${b},0.24);background:linear-gradient(135deg,rgba(255,255,255,0.14) 0%,rgba(255,255,255,0.05) 100%);">
          <div class="qr-code-wrap">
            <img class="qr-img" src="${qr}" alt="QR code">
          </div>
          <div class="qr-text">
            <div class="qr-kicker" style="color:${accent};">SCAN TO LISTEN</div>
            <div class="qr-cta">Listen to this episode on Spotify</div>
            <div class="qr-url">open.spotify.com</div>
          </div>
        </div>

      </div>
    </div>`;
}
