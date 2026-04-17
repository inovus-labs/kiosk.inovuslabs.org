# Inovus Labs — Kiosk Display

[![Build & Deploy](https://github.com/inovus-labs/kiosk.inovuslabs.org/actions/workflows/build-and-deploy.yml/badge.svg)](https://github.com/inovus-labs/kiosk.inovuslabs.org/actions/workflows/build-and-deploy.yml)
[![Last Commit](https://img.shields.io/github/last-commit/inovus-labs/kiosk.inovuslabs.org?color=6C63FF&label=last%20commit)](https://github.com/inovus-labs/kiosk.inovuslabs.org/commits/master)
[![License: MIT](https://img.shields.io/badge/License-MIT-6C63FF.svg)](LICENSE)
[![Display](https://img.shields.io/badge/Display-1080_×_1920_Portrait-6C63FF)](https://kiosk.inovuslabs.org)

A purpose-built portrait kiosk running on a 1080 × 1920 TV screen at Inovus Labs. Content is pulled from live sources, built nightly, and deployed automatically — no manual updates, ever.


## How it works

```mermaid
flowchart LR
    A[(Ghost CMS)] -->|Content API| B[GitHub Actions\nBuilds nightly]
    E[(Podcast RSS)] -->|Anchor FM| B
    B -->|Deploys to\ngh-pages branch| C[GitHub Pages]
    C -->|Auto-refreshes\nevery 30 min| D[Portrait TV\n1080 × 1920]
```

The workflow runs at midnight UTC every day (and on demand). It fetches content from all enabled sources, generates a fully self-contained `index.html`, and pushes it to the `gh-pages` branch — which GitHub Pages picks up and serves.


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

All other settings — Ghost URL, podcast RSS feed, episode limits, sound — are configured in [`config.json`](config.json):

```json
{
  "ghost":   { "enable": true, "apiUrl": "https://blog.inovuslabs.org", "postLimit": 10 },
  "podcast": { "enable": true, "rssUrl": "https://anchor.fm/s/.../podcast/rss", "episodeLimit": 10 },
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
Runs daily at midnight UTC and on manual trigger via `workflow_dispatch`.

Set this in repository **Settings → Secrets and variables → Actions secrets**:

| Name | Description |
|---|---|
| `GHOST_CONTENT_API_KEY` | Ghost Content API key |

GitHub Pages must be set to serve from the `gh-pages` branch.


## Display specs

| Property | Value |
|---|---|
| Resolution | 1080 × 1920 |
| Orientation | Portrait |
| Slide duration | 10 seconds |
| Page refresh | Every 30 minutes |
| Deployment | Nightly at 00:00 UTC |


## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details. Please do not use the [Inovus Labs](https://inovuslabs.org) name or branding without permission.
