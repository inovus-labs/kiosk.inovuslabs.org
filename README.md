# Inovus Labs — Kiosk Display

[![Build & Deploy](https://github.com/inovus-labs/kiosk.inovuslabs.org/actions/workflows/build-and-deploy.yml/badge.svg)](https://github.com/inovus-labs/kiosk.inovuslabs.org/actions/workflows/build-and-deploy.yml)
[![Last Commit](https://img.shields.io/github/last-commit/inovus-labs/kiosk.inovuslabs.org?color=6C63FF&label=last%20commit)](https://github.com/inovus-labs/kiosk.inovuslabs.org/commits/master)
[![License: MIT](https://img.shields.io/badge/License-MIT-6C63FF.svg)](LICENSE)
[![Display](https://img.shields.io/badge/Display-1080_×_1920_Portrait-6C63FF)](https://kiosk.inovuslabs.org)

A purpose-built portrait kiosk running on a 1080 × 1920 TV screen at Inovus Labs. Content is pulled from live sources, rebuilt the moment a post is published, and deployed automatically — no manual updates, ever.


## How it works

```mermaid
flowchart TD
    %% ── Sources ─────────────────────────────────
    A[(Ghost CMS)]:::source
    E[(Podcast RSS)]:::source

    %% ── Build & deploy pipeline ─────────────────
    W[Cloudflare Worker]:::cf
    B[GitHub Actions]:::gh
    C[GitHub Pages]:::gh
    D[Portrait TV<br/>1080 × 1920]:::tv

    %% ── Post-deploy side channel ────────────────
    BR[Cloudflare Browser<br/>Rendering API]:::cf
    F[Discord]:::discord

    A -->|Webhook| W
    W -->|repository_dispatch| B
    E -->|Anchor FM| B
    B -->|Deploys to gh-pages| C
    C -->|Auto-refresh every 30 min| D

    B -.->|Capture slide| BR
    BR -.->|PNG| B
    B -.->|Slide PNG| F

    classDef source  fill:#FEF3C7,stroke:#F59E0B,color:#78350F;
    classDef cf      fill:#FFE4CC,stroke:#F38020,color:#7C2D12;
    classDef gh      fill:#E5E7EB,stroke:#374151,color:#111827;
    classDef tv      fill:#6C63FF,stroke:#4F46E5,color:#FFFFFF;
    classDef discord fill:#5865F2,stroke:#4752C4,color:#FFFFFF;
```

Ghost fires a webhook on `post.published` / `post.updated` / `post.unpublished`. A small Cloudflare Worker verifies a shared-secret token and translates the event into a GitHub `repository_dispatch`, which kicks off the build. The job fetches all enabled sources, generates a fully self-contained `index.html`, and pushes it to the `gh-pages` branch — which GitHub Pages picks up and serves. After deploy, the newest blog slide is captured via Cloudflare Browser Rendering and posted to Discord as a story-ready 1080×1920 PNG.

The workflow can also be run manually via `workflow_dispatch`.


## On screen

| Content | Source | Status |
|---|---|---|
| Blog posts | Ghost CMS | ✅ Live |
| Podcast episodes | Anchor FM RSS | ✅ Live |


## Features

- Slides cycle every 10 seconds with smooth fade transitions and a progress bar. Dot indicators at the bottom track position.
- Cover images slowly zoom during each slide — keeps the screen alive without being distracting.
- Every blog slide has a scannable QR code that opens the full post on your phone, with UTM parameters for tracking.
- Podcast slides show episode artwork, duration, release date, and a QR code linking to Spotify.
- Always-on HH:MM clock in the top-right, with a blinking separator.
- Optional SomaFM radio stream running quietly in the background.
- Any screen that isn't portrait and close to 9:16 gets a friendly overlay instead of a broken layout.
- After every deploy, the newest blog slide is auto-posted to Discord — sized for Instagram stories and WhatsApp status.


## Getting started

**Prerequisites:** [Bun](https://bun.sh)

```bash
git clone https://github.com/inovus-labs/kiosk.inovuslabs.org.git
cd kiosk.inovuslabs.org
bun install
```

Set your Ghost API key as an environment variable:

```bash
export GHOST_CONTENT_API_KEY=your_key_here
```

All other settings — Ghost URL, podcast RSS feed, item limits, sound — are configured in [`config.json`](config.json):

```json
{
  "ghost":   { "enable": true, "apiUrl": "https://blog.inovuslabs.org", "postLimit": 6 },
  "podcast": { "enable": true, "rssUrl": "https://anchor.fm/s/.../podcast/rss", "episodeLimit": 6 },
  "display": { "logoUrl": "https://inovuslabs.org/assets/logo.svg", "enableSound": true }
}
```

Build and preview:

```bash
bun run build    # writes to out/
bun run preview  # build + open in browser
```


## Deployment

Handled by [`.github/workflows/build-and-deploy.yml`](.github/workflows/build-and-deploy.yml).
Triggered by `repository_dispatch` (event type `ghost-publish`, sent by the Cloudflare Worker) and by manual `workflow_dispatch`.

Set these in repository **Settings → Secrets and variables → Actions secrets**:

| Name | Description |
|---|---|
| `GHOST_CONTENT_API_KEY` | Ghost Content API key |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID — used by the Browser Rendering screenshot step |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Browser Rendering permissions |
| `DISCORD_WEBHOOK_URL` | Discord webhook the post-deploy screenshot is sent to |

GitHub Pages must be set to serve from the `gh-pages` branch.


## Ghost webhook bridge

The [`worker/`](worker/) directory contains a Cloudflare Worker (`kiosk-ghost-webhook`) that receives Ghost custom-integration webhooks and fires a GitHub `repository_dispatch` at this repo. Ghost is configured to POST to the Worker URL with `?token=<secret>` appended.

Deploy with [`wrangler`](https://developers.cloudflare.com/workers/wrangler/):

```bash
cd worker
bun install
bunx wrangler deploy
```

Worker secrets (set via `wrangler secret put`):

| Name | Description |
|---|---|
| `GH_TOKEN` | GitHub fine-grained PAT scoped to this repo with `Contents: write` |
| `WEBHOOK_SECRET` | Random string; same value goes into the Ghost webhook URL as `?token=` |


## Display specs

| Property | Value |
|---|---|
| Resolution | 1080 × 1920 |
| Orientation | Portrait |
| Slide duration | 10 seconds |
| Page refresh | Every 30 minutes |
| Build trigger | Ghost webhook (or manual dispatch) |


## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details. Please do not use the [Inovus Labs](https://inovuslabs.org) name or branding without permission.
