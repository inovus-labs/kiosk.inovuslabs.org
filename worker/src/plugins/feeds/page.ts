import type { Block, BlockInteraction, BlockResponse } from "@emdash-cms/blocks/server";
import type { PluginContext } from "emdash";
import { pollAll } from "./poll";
import { addFeed, editFeed, feedStore, listFeeds } from "./store";

export const PAGE_PATH = "/feeds";

export async function renderPage(ctx: PluginContext, isAdmin: boolean, editing?: string): Promise<Block[]> {
	const feeds = await listFeeds(ctx);
	const edited = feeds.find(({ id }) => id === editing);
	const failing = feeds.filter(({ data }) => data.lastError);
	const hasWebhook = Boolean(await ctx.settings.get<string>("webhookUrl"));

	const blocks: Block[] = [
		{ type: "header", text: "Discord feeds" },
		{
			type: "context",
			text: "New posts from these feeds are announced on Discord every 10 minutes. A newly added feed announces its latest post first.",
		},
	];
	if (isAdmin && !hasWebhook) {
		blocks.push({
			type: "banner",
			variant: "alert",
			title: "No Discord webhook set",
			description: "Nothing is announced until a webhook URL is added in the plugin settings.",
		});
	}
	blocks.push({
		type: "stats",
		items: [
			{ label: "Feeds", value: feeds.length },
			{ label: "Failing", value: failing.length, trend: failing.length > 0 ? "down" : "neutral" },
		],
	});
	if (isAdmin && edited) {
		blocks.push(
			{
				type: "context",
				text: `Editing ${edited.data.name}. A new URL counts as a new feed: its latest post is announced once.`,
			},
			{
				type: "form",
				block_id: `edit:${edited.id}`,
				fields: [
					{ type: "text_input", action_id: "url", label: "Feed URL", initial_value: edited.data.url },
					{
						type: "text_input",
						action_id: "name",
						label: "Name",
						placeholder: "Defaults to the feed's title",
						initial_value: edited.data.name,
					},
				],
				submit: { label: "Save", action_id: "save" },
			},
			{
				type: "actions",
				elements: [{ type: "button", action_id: "cancel", label: "Cancel", style: "secondary" }],
			},
		);
	} else if (isAdmin) {
		blocks.push({
			type: "form",
			block_id: "add",
			fields: [
				{ type: "text_input", action_id: "url", label: "Feed URL", placeholder: "https://example.com/feed.xml" },
				{ type: "text_input", action_id: "name", label: "Name", placeholder: "Defaults to the feed's title" },
			],
			submit: { label: "Add feed", action_id: "add" },
		});
	}
	if (failing.length > 0) {
		blocks.push({
			type: "banner",
			variant: "error",
			title: `${failing.length} feed${failing.length === 1 ? "" : "s"} failing`,
			description: failing.map(({ data }) => `${data.name}: ${data.lastError}`).join("\n"),
		});
	}
	blocks.push({
		type: "table",
		block_id: "feeds",
		page_action_id: "feeds_page",
		empty_text: isAdmin ? "No feeds yet. Add one above." : "No feeds yet.",
		columns: [
			{ key: "name", label: "Name" },
			{ key: "url", label: "Feed URL", format: "code" },
			{ key: "status", label: "Status", format: "badge" },
			{ key: "lastPostAt", label: "Last announced", format: "relative_time" },
			{ key: "lastPostTitle", label: "Last post" },
			...(isAdmin
				? ([
						{ key: "edit", label: "", format: "element" },
						{ key: "remove", label: "", format: "element" },
					] as const)
				: []),
		],
		rows: feeds.map(({ id, data }) => ({
			name: data.name,
			url: data.url,
			status: data.lastError ? "Failing" : "Active",
			lastPostAt: data.lastPostAt ?? "",
			lastPostTitle: data.lastPostTitle ?? "—",
			...(isAdmin && {
				edit: { type: "button", action_id: "edit", label: "Edit", style: "secondary", value: id },
				remove: {
					type: "button",
					action_id: "remove",
					label: "Remove",
					style: "danger",
					value: id,
					confirm: {
						title: `Remove ${data.name}?`,
						text: "Its posts stop being announced. Adding it back later won't repost what was already announced.",
						confirm: "Remove",
						deny: "Cancel",
						style: "danger",
					},
				},
			}),
		})),
	});
	if (isAdmin) {
		blocks.push({
			type: "actions",
			elements: [
				{ type: "button", action_id: "poll", label: "Check feeds now", style: "primary" },
				{
					type: "link",
					label: "Webhook settings",
					target: { kind: "plugin-settings" },
					appearance: "secondary",
				},
			],
		});
	}
	return blocks;
}

export const editedId = (interaction: BlockInteraction) =>
	interaction.type === "form_submit" && interaction.action_id === "save"
		? interaction.block_id?.replace(/^edit:/, "")
		: undefined;

export async function handleInteraction(
	ctx: PluginContext,
	interaction: BlockInteraction,
): Promise<{ toast?: BlockResponse["toast"]; editing?: string }> {
	if (interaction.type === "form_submit" && interaction.action_id === "add") {
		const values = interaction.values as { name?: string; url?: string };
		const record = await addFeed(ctx, values.name ?? "", values.url ?? "");
		return { toast: { message: `Added ${record.name}`, type: "success" } };
	}
	if (interaction.type === "form_submit" && interaction.action_id === "save") {
		const values = interaction.values as { name?: string; url?: string };
		const record = await editFeed(ctx, editedId(interaction) ?? "", values.name ?? "", values.url ?? "");
		return { toast: { message: `Saved ${record.name}`, type: "success" } };
	}
	if (interaction.type !== "block_action") return {};

	const id = String(interaction.value ?? "");
	if (interaction.action_id === "edit") return { editing: id };
	if (interaction.action_id === "remove") {
		const record = await feedStore(ctx).get(id);
		await feedStore(ctx).delete(id);
		return { toast: { message: `Removed ${record?.name ?? "feed"}`, type: "success" } };
	}
	if (interaction.action_id === "poll") {
		if (!(await ctx.settings.get<string>("webhookUrl"))) {
			throw new Error("Set the Discord webhook URL in the plugin settings first");
		}
		const announced = await pollAll(ctx);
		return {
			toast: {
				message: announced > 0 ? `Announced ${announced} new post${announced === 1 ? "" : "s"}` : "No new posts",
				type: "info",
			},
		};
	}
	return {};
}
