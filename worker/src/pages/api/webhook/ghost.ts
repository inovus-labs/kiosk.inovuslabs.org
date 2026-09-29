import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { dispatchBuild } from "../../../lib/github";

export const prerender = false;

export const GET: APIRoute = () => new Response("ok");

// Ghost custom-integration webhook (post.published / post.unpublished) -> kiosk rebuild.
export const POST: APIRoute = async ({ request, url }) => {
	if (!env.WEBHOOK_SECRET || url.searchParams.get("token") !== env.WEBHOOK_SECRET) {
		return new Response("forbidden", { status: 403 });
	}

	const res = await dispatchBuild(env.GHOST_DISPATCH_EVENT_TYPE, {
		ghost_event: request.headers.get("X-Ghost-Event") || "unknown",
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		return new Response(`github dispatch failed: ${res.status} ${detail.slice(0, 200)}`, {
			status: 502,
		});
	}
	return new Response(null, { status: 204 });
};
