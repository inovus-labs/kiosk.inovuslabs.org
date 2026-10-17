import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { announceOnBluesky } from "../../../lib/bluesky";
import type { GhostPost } from "../../../lib/bluesky-post";
import { dispatchBuild } from "../../../lib/github";

export const prerender = false;

export const GET: APIRoute = () => new Response("ok");

type GhostWebhook = { post?: { current?: GhostPost; previous?: Partial<GhostPost> } };

// Ghost may not send X-Ghost-Event, so a first publish is read from the status change itself.
function newlyPublished(body: GhostWebhook): GhostPost | undefined {
	const { current, previous } = body.post ?? {};
	if (current?.status !== "published" || current.visibility !== "public") return;
	if (!previous || !("status" in previous) || previous.status === "published") return;
	return current;
}

// Ghost custom-integration webhook (post.published / post.unpublished) -> kiosk rebuild and Bluesky post.
export const POST: APIRoute = async ({ request, url }) => {
	if (!env.WEBHOOK_SECRET || url.searchParams.get("token") !== env.WEBHOOK_SECRET) {
		return new Response("forbidden", { status: 403 });
	}

	const body = (await request.json().catch(() => ({}))) as GhostWebhook;
	const published = newlyPublished(body);
	if (published) announceOnBluesky(published);

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
