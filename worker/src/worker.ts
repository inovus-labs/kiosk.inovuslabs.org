import handler, { createScheduledHandler, PluginBridge } from "@emdash-cms/cloudflare/worker";
import { withEmDashRuntime } from "emdash/middleware";
import { proxyActivityPub } from "./lib/activitypub";

export { PluginBridge };

const emdashScheduled = createScheduledHandler();

export default {
	...handler,
	fetch(request, env, ctx) {
		if (new URL(request.url).hostname === env.GHOST_BLOG_HOST) {
			return proxyActivityPub(request, env.ACTIVITYPUB_TARGET);
		}
		return handler.fetch!(request, env, ctx);
	},
	// Every minute: EmDash publishes due scheduled slides, then we unpublish expired ones.
	// Both paths end in the kiosk plugin's hooks, which dispatch the GitHub rebuild.
	async scheduled(controller, env, ctx) {
		await emdashScheduled(controller, env, ctx);
		ctx.waitUntil(
			withEmDashRuntime(async (runtime) => {
				const result = await runtime.handlePluginApiRoute(
					"kiosk",
					"POST",
					"/expire",
					new Request("https://internal/", { method: "POST" }),
				);
				if (!result.success) console.error("[kiosk] expire sweep failed:", result.error);
			}).catch((error) => console.error("[kiosk] expire sweep threw:", error)),
		);
	},
} satisfies ExportedHandler<Env>;
