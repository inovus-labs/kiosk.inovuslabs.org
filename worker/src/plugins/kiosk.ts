import { definePlugin } from "emdash";
import type { PluginContext } from "emdash";

const COLLECTION = "slides";

/**
 * Rebuild the kiosk whenever the set of live slides changes.
 *
 * Publish, unpublish and trash are the only transitions that change what the
 * kiosk shows: `slides` has revisions enabled, so saving a published slide only
 * edits its draft until "Publish changes". Scheduled publishing runs the same
 * `afterPublish` hook when the slide goes live, and the `expire` route below
 * unpublishes expired slides, which lands in `afterUnpublish`.
 */
async function rebuild(ctx: PluginContext, event: string, content?: Record<string, unknown>) {
	const title = (content?.data as { title?: string } | undefined)?.title;
	try {
		const { env } = await import("cloudflare:workers");
		const { dispatchBuild } = await import("../lib/github");
		const res = await dispatchBuild(env.CMS_DISPATCH_EVENT_TYPE, { source: "emdash", event, title });
		if (!res.ok) {
			const detail = await res.text().catch(() => "");
			ctx.log.error("GitHub dispatch failed", { event, status: res.status, detail: detail.slice(0, 200) });
			return;
		}
		ctx.log.info("Kiosk rebuild dispatched", { event, title });
	} catch (error) {
		// Hook errors are otherwise swallowed by the pipeline; surface them in Worker logs.
		ctx.log.error("GitHub dispatch threw", { event, error: String(error) });
	}
}

export function createPlugin() {
	return definePlugin({
		id: "kiosk",
		version: "1.0.0",
		capabilities: ["content:publish"],
		hooks: {
			"content:afterPublish": {
				timeout: 10_000,
				handler: async ({ collection, content }, ctx) => {
					if (collection === COLLECTION) await rebuild(ctx, "slide.publish", content);
				},
			},
			"content:afterUnpublish": {
				timeout: 10_000,
				handler: async ({ collection, content }, ctx) => {
					if (collection === COLLECTION) await rebuild(ctx, "slide.unpublish", content);
				},
			},
			// Moving a live slide to trash removes it from the feed; purging an
			// already-trashed slide does not.
			"content:afterDelete": {
				timeout: 10_000,
				handler: async ({ collection, permanent }, ctx) => {
					if (collection === COLLECTION && !permanent) await rebuild(ctx, "slide.delete");
				},
			},
		},
		routes: {
			// Private route: invoked every minute from src/worker.ts, or by an admin.
			expire: {
				handler: async (ctx) => {
					const content = ctx.content!;
					const { items } = await content.list(COLLECTION, {
						limit: 50,
						where: {
							status: "published",
							fieldFilters: { expires_at: { lte: new Date().toISOString() } },
						},
					});
					const expired: string[] = [];
					for (const item of items) {
						const current = await content.getVersioned!(COLLECTION, item.id);
						if (!current) continue;
						await content.unpublish!(COLLECTION, item.id, { _rev: current._rev });
						expired.push(item.id);
					}
					if (expired.length > 0) ctx.log.info("Unpublished expired slides", { expired });
					return { expired };
				},
			},
		},
	});
}
