import type { APIRoute } from "astro";
import { getEmDashCollection } from "emdash";

export const prerender = false;

const MAX_LIMIT = 50;

type Slide = {
	id: string;
	type: "image" | "text";
	title: string;
	body: string | null;
	theme: string | null;
	imageUrl: string | null;
	publishedAt: string | null;
	expiresAt: string | null;
	pinnedOrder: number | null;
};

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
	const query = { status: "published", limit: MAX_LIMIT } as const;
	const [images, texts] = await Promise.all([
		getEmDashCollection("image_slides", query),
		getEmDashCollection("text_slides", query),
	]);
	const error = images.error ?? texts.error;
	if (error) {
		console.error("[slides] query failed:", error);
		return Response.json({ error: "Unable to load slides" }, { status: 500 });
	}

	const slides: Slide[] = [
		...images.entries.map(({ data }) => ({
			id: data.id,
			type: "image" as const,
			title: data.title,
			body: null,
			theme: null,
			imageUrl: mediaUrl(data.image),
			publishedAt: data.publishedAt?.toISOString() ?? null,
			expiresAt: data.expires_at ?? null,
			pinnedOrder: data.pinned_order ?? null,
		})),
		...texts.entries.map(({ data }) => ({
			id: data.id,
			type: "text" as const,
			title: data.title,
			body: data.body ?? null,
			theme: data.theme ?? null,
			imageUrl: null,
			publishedAt: data.publishedAt?.toISOString() ?? null,
			expiresAt: data.expires_at ?? null,
			pinnedOrder: data.pinned_order ?? null,
		})),
	];

	const now = Date.now();
	const live = slides
		// The expiry sweep runs every minute; this closes the gap in between.
		.filter((slide) => !slide.expiresAt || Date.parse(slide.expiresAt) > now)
		// Pinned first (ascending), then newest first.
		.sort((a, b) => {
			if (a.pinnedOrder !== b.pinnedOrder) {
				if (a.pinnedOrder === null) return 1;
				if (b.pinnedOrder === null) return -1;
				return a.pinnedOrder - b.pinnedOrder;
			}
			return (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
		})
		.slice(0, limit);

	return Response.json({ slides: live }, { headers: { "Cache-Control": "no-store" } });
};
