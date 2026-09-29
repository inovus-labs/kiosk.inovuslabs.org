import handler, { createScheduledHandler, PluginBridge } from "@emdash-cms/cloudflare/worker";
import { withEmDashRuntime } from "emdash/middleware";

export { PluginBridge };

const emdashScheduled = createScheduledHandler();

export default {
	...handler,
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
