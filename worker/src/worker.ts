import handler, { createScheduledHandler, PluginBridge } from "@emdash-cms/cloudflare/worker";

export { PluginBridge };

export default {
	...handler,
	// Every minute: EmDash publishes due scheduled slides.
	scheduled: createScheduledHandler(),
} satisfies ExportedHandler<Env>;
