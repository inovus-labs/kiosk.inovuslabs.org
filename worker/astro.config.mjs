import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1, r2 } from "@emdash-cms/cloudflare";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";

// In-repo native plugin: GitHub build dispatch + slide expiry (src/plugins/kiosk.ts).
const kioskPlugin = {
	id: "kiosk",
	version: "1.0.0",
	format: "native",
	entrypoint: fileURLToPath(new URL("./src/plugins/kiosk.ts", import.meta.url)),
};

export default defineConfig({
	output: "server",
	adapter: cloudflare(),
	integrations: [
		react(), // EmDash admin UI is a React app
		emdash({
			database: d1({ binding: "DB" }),
			storage: r2({ binding: "MEDIA" }),
			plugins: [kioskPlugin],
		}),
	],
	devToolbar: { enabled: false },
});
