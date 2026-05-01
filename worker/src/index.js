// Ghost CMS → GitHub Actions repository_dispatch trigger.
// Ghost's custom-integration webhooks POST here on post.published / post.updated /
// post.unpublished. We verify a shared-secret token in the URL, then fire a
// repository_dispatch at the kiosk-display repo so the kiosk rebuilds within minutes.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET') {
      return new Response('ok', { status: 200 });
    }
    if (request.method !== 'POST') {
      return new Response('method not allowed', { status: 405 });
    }
    if (url.searchParams.get('token') !== env.WEBHOOK_SECRET) {
      return new Response('forbidden', { status: 403 });
    }

    const ghostEvent = request.headers.get('X-Ghost-Event') || 'unknown';

    const ghRes = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GH_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'kiosk-ghost-webhook',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event_type: env.DISPATCH_EVENT_TYPE,
        client_payload: { ghost_event: ghostEvent },
      }),
    });

    if (!ghRes.ok) {
      const detail = await ghRes.text().catch(() => '');
      return new Response(
        `github dispatch failed: ${ghRes.status} ${detail.slice(0, 200)}`,
        { status: 502 },
      );
    }

    return new Response(null, { status: 204 });
  },
};
