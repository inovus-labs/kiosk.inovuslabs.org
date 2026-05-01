// Captures the newest blog slide (index 0) via Cloudflare Browser Rendering REST,
// then posts it to a Discord webhook as a rich embed with the PNG attached.
// Runs after `Deploy to GitHub Pages`. Must never fail the deploy: any error → exit 0.

const {
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN,
  DISCORD_WEBHOOK_URL,
  RUN_NUMBER,
  KIOSK_URL = 'https://kiosk.inovuslabs.org',
} = process.env;

function warn(msg) { console.warn(`[post-screenshots] ${msg}`); }
function info(msg) { console.log(`[post-screenshots] ${msg}`); }

if (!DISCORD_WEBHOOK_URL || !CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) {
  warn('missing one of DISCORD_WEBHOOK_URL / CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN — skipping');
  process.exit(0);
}
if (!RUN_NUMBER) {
  warn('missing RUN_NUMBER — skipping');
  process.exit(0);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function pollManifest() {
  const deadline = Date.now() + 5 * 60 * 1000; // 5 min
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${KIOSK_URL}/manifest.json?cb=${RUN_NUMBER}-${Date.now()}`, {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (res.ok) {
        const m = await res.json();
        if (String(m.buildId) === String(RUN_NUMBER)) return m;
        info(`manifest live but stale (buildId=${m.buildId}, want=${RUN_NUMBER}); waiting…`);
      } else {
        info(`manifest fetch ${res.status}; waiting…`);
      }
    } catch (e) {
      info(`manifest fetch threw: ${e.message}; waiting…`);
    }
    await sleep(5000);
  }
  return null;
}

async function captureSlide(i) {
  const body = {
    url: `${KIOSK_URL}/?screenshot=${i}&cb=${RUN_NUMBER}`,
    viewport: { width: 1080, height: 1920, deviceScaleFactor: 1 },
    screenshotOptions: { type: 'png', fullPage: false, omitBackground: false },
    gotoOptions: { waitUntil: 'networkidle0', timeout: 30000 },
    waitForSelector: { selector: '.slide.active', timeout: 10000 },
    waitForTimeout: 2000,
  };
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/browser-rendering/screenshot`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    warn(`slide ${i}: Cloudflare returned ${res.status} ${res.statusText}`);
    try { warn(`body: ${(await res.text()).slice(0, 400)}`); } catch {}
    return null;
  }
  const ctype = res.headers.get('content-type') || '';
  if (ctype.startsWith('image/')) {
    return Buffer.from(await res.arrayBuffer());
  }
  // Cloudflare sometimes wraps the PNG inside a JSON envelope { result: "<base64>" }
  try {
    const json = await res.json();
    const b64 = json.result || json.data || json.image;
    if (typeof b64 === 'string') return Buffer.from(b64, 'base64');
  } catch {}
  warn(`slide ${i}: unexpected response shape`);
  return null;
}

async function postToDiscord(png, manifest) {
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const runUrl = (repo && runId)
    ? `https://github.com/${repo}/actions/runs/${runId}`
    : KIOSK_URL;
  const footerText = KIOSK_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');

  const description =
    `**[Open kiosk](${KIOSK_URL})** — portrait **1080×1920**. ` +
    `Preview: **newest blog slide** (index **0**, newest first in the carousel).`;

  const embed = {
    title: 'Kiosk deploy · screenshot ready',
    url: KIOSK_URL,
    description,
    color: 903920,
    author: { name: 'GitHub Actions', url: runUrl },
    fields: [
      { name: 'Build', value: `**#${RUN_NUMBER}**`, inline: true },
      {
        name: 'On the kiosk now',
        value: `**${manifest.slideCount}** slides · **${manifest.blogCount}** blog · **${manifest.podcastCount}** podcast`,
        inline: true,
      },
      {
        name: 'Screenshot',
        value: '**1** PNG · live site capture · Cloudflare Browser Rendering → Discord',
        inline: false,
      },
      { name: 'Workflow', value: `[Run logs & job summary](${runUrl})`, inline: false },
    ],
    image: { url: 'attachment://slide-1.png' },
    footer: { text: footerText },
    timestamp: new Date().toISOString(),
  };

  const payload = {
    username: 'Kiosk Build',
    embeds: [embed],
  };

  const form = new FormData();
  form.append('payload_json', JSON.stringify(payload));
  form.append('files[0]', new Blob([png], { type: 'image/png' }), 'slide-1.png');

  const res = await fetch(DISCORD_WEBHOOK_URL, { method: 'POST', body: form });
  if (!res.ok) {
    warn(`Discord POST failed: ${res.status} ${res.statusText}`);
    try { warn(`body: ${(await res.text()).slice(0, 400)}`); } catch {}
    return;
  }
  info(`posted screenshot to Discord (status ${res.status})`);
}

async function main() {
  info(`waiting for manifest to publish buildId=${RUN_NUMBER} at ${KIOSK_URL}…`);
  const manifest = await pollManifest();
  if (!manifest) {
    warn('timed out waiting for live manifest; skipping');
    return;
  }
  info(`manifest live: ${JSON.stringify(manifest)}`);

  const blogCount = Number(manifest.blogCount) || 0;
  if (blogCount === 0) {
    info('blogCount=0; nothing to screenshot');
    return;
  }

  info('capturing slide 0 (newest blog)…');
  const png = await captureSlide(0);
  if (!png) {
    warn('no screenshot captured; nothing to post');
    return;
  }
  await postToDiscord(png, manifest);
}

main().catch(e => {
  warn(`unexpected error: ${e.stack || e.message || e}`);
  process.exit(0);
});
