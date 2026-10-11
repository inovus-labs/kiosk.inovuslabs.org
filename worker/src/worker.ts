import handler, { createScheduledHandler, PluginBridge } from "@emdash-cms/cloudflare/worker";
import { withEmDashRuntime } from "emdash/middleware";
import { proxyActivityPub } from "./lib/activitypub";

export { PluginBridge };

const emdashScheduled = createScheduledHandler();

const CRON_HOST = "cron.internal";

function runPluginRoute(pluginId: string, path: string) {
	return withEmDashRuntime(async (runtime) => {
		const result = await runtime.handlePluginApiRoute(
			pluginId,
			"POST",
			path,
			new Request("https://internal/", { method: "POST" }),
		);
		if (!result.success) console.error(`[${pluginId}] ${path} failed:`, result.error);
	}).catch((error) => console.error(`[${pluginId}] ${path} threw:`, error));
}

// Every minute: EmDash publishes due scheduled slides, then we unpublish expired ones.
// Both paths end in the kiosk plugin's hooks, which dispatch the GitHub rebuild.
async function runCron(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
	await emdashScheduled(controller, env, ctx);
	const tasks = [runPluginRoute("kiosk", "/expire")];
	if (new Date(controller.scheduledTime).getUTCMinutes() === 0) tasks.push(runPluginRoute("feeds", "/poll"));
	await Promise.all(tasks);
}

export default {
	...handler,
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		if (url.hostname === CRON_HOST) {
			const scheduledTime = Number(url.searchParams.get("time"));
			await runCron({ scheduledTime, cron: url.searchParams.get("cron") ?? "", noRetry() {} }, env, ctx);
			return new Response(null, { status: 204 });
		}
		if (url.hostname === env.GHOST_BLOG_HOST) {
			return proxyActivityPub(request, env.ACTIVITYPUB_TARGET);
		}
		if (url.hostname === env.SOCIAL_WEB_DOMAIN) {
			return Response.redirect(`https://${env.GHOST_BLOG_HOST}${url.pathname}${url.search}`, 302);
		}
		return handler.fetch!(request, env, ctx);
	},
	// Free-plan cron runs can't fit EmDash's boot in 10 ms CPU; fetch requests can.
	scheduled(controller, _env, ctx) {
		const url = new URL(`https://${CRON_HOST}/`);
		url.searchParams.set("time", String(controller.scheduledTime));
		url.searchParams.set("cron", controller.cron);
		ctx.waitUntil(ctx.exports.default.fetch(url));
	},
} satisfies ExportedHandler<Env>;
