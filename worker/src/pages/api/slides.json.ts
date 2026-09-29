import type { APIRoute } from "astro";
import { getEmDashCollection } from "emdash";

export const prerender = false;

const MAX_LIMIT = 50;

/**
 * Public feed of the slides currently live on the kiosk, in display order.
 * Read by the GitHub Actions build (scripts/customs.js).
 */
export const GET: APIRoute = async ({ url, locals }) => {
	// Image fields store the media reference; resolve it to a URL the build can download.
	const mediaUrl = (image?: { src?: string; meta?: { storageKey?: string } }) => {
		const key = image?.meta?.storageKey;
		const src = key ? locals.emdash?.getPublicMediaUrl?.(key) : image?.src;
		return src ? new URL(src, url.origin).href : null;
	};

	const limit = Math.min(Number(url.searchParams.get("limit")) || 10, MAX_LIMIT);
	const { entries, error } = await getEmDashCollection("slides", {
		status: "published",
		orderBy: { published_at: "desc" },
		limit: MAX_LIMIT,
	});
	if (error) {
		console.error("[slides] query failed:", error);
		return Response.json({ error: "Unable to load slides" }, { status: 500 });
	}

	const now = Date.now();
	const slides = entries
		.map(({ data }) => ({
			id: data.id,
			type: data.type,
			title: data.title,
			body: data.body ?? null,
			theme: data.theme ?? null,
			imageUrl: mediaUrl(data.image),
			publishedAt: data.publishedAt?.toISOString() ?? null,
			expiresAt: data.expires_at ?? null,
			pinnedOrder: data.pinned_order ?? null,
		}))
		// The expiry sweep runs every minute; this closes the gap in between.
		.filter((slide) => !slide.expiresAt || Date.parse(slide.expiresAt) > now)
		// Pinned first (ascending), then newest first. Entries arrive newest first and sort is stable.
		.sort((a, b) => {
			if (a.pinnedOrder === b.pinnedOrder) return 0;
			if (a.pinnedOrder === null) return 1;
			if (b.pinnedOrder === null) return -1;
			return a.pinnedOrder - b.pinnedOrder;
		})
		.slice(0, limit);

	return Response.json({ slides }, { headers: { "Cache-Control": "no-store" } });
};
