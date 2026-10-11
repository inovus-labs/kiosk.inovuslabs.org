import type { BlockInteraction, BlockResponse } from "@emdash-cms/blocks/server";
import { definePlugin } from "emdash";
import { editedId, handleInteraction, PAGE_PATH, renderPage } from "./page";
import { pollAll } from "./poll";

const ADMIN_ROLE = 50;

export function createPlugin() {
	return definePlugin({
		id: "feeds",
		version: "1.0.0",
		storage: {
			feeds: { indexes: ["name"], uniqueIndexes: ["url"] },
		},
		admin: {
			pages: [{ path: PAGE_PATH, label: "Discord feeds", icon: "rss" }],
			settingsSchema: {
				webhookUrl: {
					type: "secret",
					label: "Discord webhook URL",
					description: "Channel webhook that new feed posts are announced to.",
				},
			},
		},
		routes: {
			// Every role can view; changes are Admin-only, checked below.
			admin: {
				permission: "content:read",
				handler: async (ctx) => {
					const interaction = ctx.input as BlockInteraction;
					const isAdmin = (ctx.user?.role ?? 0) >= ADMIN_ROLE;
					let result: Awaited<ReturnType<typeof handleInteraction>>;
					try {
						if (!isAdmin && interaction.type !== "page_load") {
							throw new Error("Only admins can change feeds");
						}
						result = await handleInteraction(ctx, interaction);
					} catch (error) {
						result = {
							toast: { message: error instanceof Error ? error.message : String(error), type: "error" },
							editing: editedId(interaction),
						};
					}
					return {
						blocks: await renderPage(ctx, isAdmin, result.editing),
						toast: result.toast,
					} satisfies BlockResponse;
				},
			},
			poll: {
				handler: async (ctx) => ({ announced: await pollAll(ctx) }),
			},
		},
	});
}
