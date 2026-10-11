import type { Block, BlockInteraction, BlockResponse } from "@emdash-cms/blocks/server";
import { definePlugin } from "emdash";
import type { PluginContext, StorageCollection } from "emdash";
import { XMLParser } from "fast-xml-parser";

const SEEN_LIMIT = 500;
// Stops a feed that re-keys its GUIDs from flooding the channel.
const MAX_NEW_PER_FEED = 5;
const SUMMARY_LENGTH = 300;
const WORDS_PER_MINUTE = 225;
const EMBED_COLOR = 0x499fbf;

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	textNodeName: "#text",
	htmlEntities: true,
});

interface FeedItem {
	id: string;
	title: string;
	link: string;
	published?: string;
	summary: string;
	author: string;
	image?: string;
	content: string;
}

interface Feed {
	title: string;
	link: string;
	items: FeedItem[];
}

class RateLimited extends Error {}
class Rejected extends Error {}

const list = <T>(value: T | T[] | undefined | null): T[] =>
	value == null ? [] : Array.isArray(value) ? value : [value];

function text(value: unknown): string {
	if (value == null) return "";
	if (Array.isArray(value)) return text(value[0]);
	if (typeof value === "object") return text((value as Record<string, unknown>)["#text"]);
	return String(value).trim();
}

const attr = (value: unknown, name: string): string =>
	text((list(value)[0] as Record<string, unknown> | undefined)?.[`@_${name}`]);

function toIso(date: string): string | undefined {
	const time = Date.parse(date);
	return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

function absoluteUrl(value: string, base: string): string | undefined {
	try {
		const url = new URL(value, base);
		return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
	} catch {
		return undefined;
	}
}

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
	lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201C", rdquo: "\u201D",
	ndash: "\u2013", mdash: "\u2014", hellip: "\u2026",
};

// HTML-typed feed text is entity-escaped twice, so the XML parser only undoes one level.
function decodeEntities(value: string): string {
	return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
		if (entity[0] !== "#") return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
		const hex = entity[1] === "x" || entity[1] === "X";
		const code = hex ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
		return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
	});
}

const plainText = (html: string) =>
	decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function summarize(html: string): string {
	const plain = plainText(html);
	if (plain.length <= SUMMARY_LENGTH) return plain;
	const cut = plain.slice(0, SUMMARY_LENGTH);
	return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[\s,;:.]+$/, "")}…`;
}

function readingTime(html: string): string | undefined {
	const words = plainText(html).split(" ").length;
	return words >= WORDS_PER_MINUTE / 2
		? `${Math.max(1, Math.round(words / WORDS_PER_MINUTE))} min read`
		: undefined;
}

// Discord can't render SVG.
function firstImage(html: string): string | undefined {
	for (const [, src] of html.matchAll(/<img\b[^>]*?\bsrc=["']([^"']+)["']/gi)) {
		if (!/\.svg(\?|$)/i.test(src)) return decodeEntities(src);
	}
	return undefined;
}

function imageOf(entry: Record<string, unknown>): string | undefined {
	const enclosure = list(entry.enclosure as Record<string, unknown>[]).find((e) =>
		text(e["@_type"]).startsWith("image/"),
	);
	return (
		attr(entry["media:thumbnail"], "url") ||
		attr(entry["media:content"], "url") ||
		(enclosure ? text(enclosure["@_url"]) : "") ||
		undefined
	);
}

function atomLink(value: unknown): string {
	const links = list(value as Record<string, unknown>[]);
	const link = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
	return link ? text(link["@_href"]) : "";
}

function parseFeed(xml: string): Feed {
	const doc = parser.parse(xml);

	if (doc.feed) {
		const feed = doc.feed;
		return {
			title: decodeEntities(text(feed.title)),
			link: atomLink(feed.link),
			items: list<Record<string, unknown>>(feed.entry).map((entry) => {
				const href = atomLink(entry.link);
				return {
					id: text(entry.id) || href,
					title: decodeEntities(text(entry.title)),
					link: href,
					published: toIso(text(entry.published) || text(entry.updated)),
					summary: summarize(text(entry.summary) || text(entry.content)),
					author: text((list(entry.author)[0] as Record<string, unknown> | undefined)?.name),
					image: imageOf(entry),
					content: text(entry.content),
				};
			}),
		};
	}

	const channel = doc.rss?.channel ?? doc["rdf:RDF"]?.channel ?? {};
	const items = doc.rss?.channel?.item ?? doc["rdf:RDF"]?.item;
	return {
		title: decodeEntities(text(channel.title)),
		link: text(channel.link),
		items: list<Record<string, unknown>>(items).map((item) => {
			const link = text(item.link);
			return {
				id: text(item.guid) || link || text(item.title),
				title: decodeEntities(text(item.title)),
				link,
				published: toIso(text(item.pubDate) || text(item["dc:date"])),
				summary: summarize(text(item.description) || text(item["content:encoded"])),
				author: text(item["dc:creator"]) || text(item.author),
				image: imageOf(item),
				content: text(item["content:encoded"]),
			};
		}),
	};
}

// Discord can't show .ico favicons; Google's service returns a PNG, or a 404 when a site has none.
async function faviconOf(ctx: PluginContext, site: string): Promise<string | undefined> {
	const url = `https://www.google.com/s2/favicons?sz=128&domain=${new URL(site).hostname}`;
	const res = await ctx.http!.fetch(url).catch(() => null);
	return res?.ok ? url : undefined;
}

async function pageImage(ctx: PluginContext, link: string): Promise<string | undefined> {
	if (!link) return undefined;
	const res = await ctx.http!.fetch(link).catch(() => null);
	if (!res?.ok) return undefined;
	const tag = (await res.text()).match(/<meta[^>]+["'](?:og:image|twitter:image)["'][^>]*>/i)?.[0];
	const content = tag?.match(/content=["']([^"']+)["']/i)?.[1];
	return content ? absoluteUrl(decodeEntities(content), link) : undefined;
}

async function announce(
	ctx: PluginContext,
	webhookUrl: string,
	feed: Feed,
	feedName: string,
	item: FeedItem,
) {
	const footer = [item.author, readingTime(item.content)].filter(Boolean).join(" · ");
	const image = item.image ?? (await pageImage(ctx, item.link));
	const icon = await faviconOf(ctx, feed.link);
	const target = new URL(webhookUrl);
	target.searchParams.set("wait", "true");
	const res = await ctx.http!.fetch(target.href, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			embeds: [
				{
					color: EMBED_COLOR,
					author: { name: feedName.slice(0, 256), url: feed.link, icon_url: icon },
					title: (item.title || item.link).slice(0, 256),
					url: item.link || undefined,
					description: item.summary || undefined,
					image: image ? { url: image } : undefined,
					footer: footer ? { text: footer.slice(0, 2048) } : undefined,
					timestamp: item.published,
				},
			],
			allowed_mentions: { parse: [] },
		}),
	});
	if (res.ok) return;
	if (res.status === 429) throw new RateLimited();
	const detail = await res.text().catch(() => "");
	const message = `Discord webhook returned ${res.status}: ${detail.slice(0, 200)}`;
	throw res.status === 400 || res.status === 413 ? new Rejected(message) : new Error(message);
}

interface FeedRecord {
	name: string;
	url: string;
	enabled: boolean;
	createdAt: string;
	lastPostAt?: string;
	lastPostTitle?: string;
	lastError?: string;
}

type FeedRow = { id: string; data: FeedRecord };

const feedStore = (ctx: PluginContext) => ctx.storage.feeds as StorageCollection<FeedRecord>;

async function listFeeds(ctx: PluginContext): Promise<FeedRow[]> {
	const rows: FeedRow[] = [];
	let cursor: string | undefined;
	do {
		const page = await feedStore(ctx).query({ orderBy: { name: "asc" }, limit: 100, cursor });
		rows.push(...page.items);
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return rows;
}

async function fetchFeed(ctx: PluginContext, url: string): Promise<Feed> {
	const res = await ctx.http!.fetch(url, {
		headers: {
			Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
			"User-Agent": "InovusLabsFeeds/1.0 (+https://kiosk-cms.inovuslabs.org)",
		},
	});
	if (!res.ok) throw new Error(`Feed returned ${res.status}`);
	const parsed = parseFeed(await res.text());
	return {
		...parsed,
		link: absoluteUrl(parsed.link, url) ?? new URL(url).origin,
		items: parsed.items
			.filter((item) => item.id)
			.map((item) => {
				const link = absoluteUrl(item.link, url) ?? "";
				const image = item.image ?? firstImage(item.content);
				return { ...item, link, image: image && absoluteUrl(image, link || url) };
			})
			.sort((a, b) => (b.published ?? "").localeCompare(a.published ?? "")),
	};
}

async function pollFeed(ctx: PluginContext, webhookUrl: string, record: FeedRecord): Promise<FeedItem[]> {
	const feed = await fetchFeed(ctx, record.url);
	const key = `seen:${record.url}`;
	const previous = await ctx.kv.get<string[]>(key);
	const seen = new Set(previous ?? []);
	const unseen = feed.items.filter((item) => !seen.has(item.id));
	const toAnnounce = unseen.slice(0, previous === null ? 1 : MAX_NEW_PER_FEED).reverse();
	const handled = new Set(unseen.map((item) => item.id));

	const announced: FeedItem[] = [];
	let failure: unknown;
	for (const [i, item] of toAnnounce.entries()) {
		try {
			await announce(ctx, webhookUrl, feed, record.name, item);
			announced.push(item);
		} catch (error) {
			if (error instanceof Rejected) {
				ctx.log.error("Discord rejected feed post; skipping it", {
					url: record.url,
					item: item.link,
					error: error.message,
				});
				continue;
			}
			// Leave this and later posts unseen so the next poll retries them.
			for (const rest of toAnnounce.slice(i)) handled.delete(rest.id);
			failure = error;
			break;
		}
	}
	if (handled.size > 0 || previous === null) {
		await ctx.kv.set(key, [...handled, ...(previous ?? [])].slice(0, SEEN_LIMIT));
	}
	if (failure) throw failure;
	return announced;
}

async function pollAll(ctx: PluginContext): Promise<Record<string, string[]>> {
	const webhookUrl = await ctx.settings.get<string>("webhookUrl");
	if (!webhookUrl) {
		ctx.log.warn("No Discord webhook URL set; skipping feed poll");
		return {};
	}

	const announced: Record<string, string[]> = {};
	for (const { id, data } of await listFeeds(ctx)) {
		if (!data.enabled) continue;
		let update: Partial<FeedRecord> | undefined;
		try {
			const posts = await pollFeed(ctx, webhookUrl, data);
			if (posts.length > 0) {
				const latest = posts[posts.length - 1]!;
				announced[data.name] = posts.map((post) => post.title);
				update = { lastPostAt: latest.published ?? new Date().toISOString(), lastPostTitle: latest.title };
			}
			if (data.lastError) update = { ...update, lastError: undefined };
		} catch (error) {
			if (error instanceof RateLimited) {
				ctx.log.warn("Discord rate limited; resuming next poll");
				break;
			}
			const message = error instanceof Error ? error.message : String(error);
			ctx.log.error("Feed poll failed", { feed: data.name, url: data.url, error: message });
			// Write only on change so a failing feed doesn't cost a D1 write every poll.
			if (message !== data.lastError) update = { lastError: message.slice(0, 300) };
		}
		if (update) await feedStore(ctx).put(id, { ...data, ...update });
	}
	if (Object.keys(announced).length > 0) ctx.log.info("Announced feed posts", { announced });
	return announced;
}

async function newFeedUrl(ctx: PluginContext, url: string): Promise<string> {
	const href = absoluteUrl(url.trim(), "about:blank");
	if (!href) throw new Error(`Not a valid http(s) URL: ${url}`);
	if ((await feedStore(ctx).count({ url: href })) > 0) throw new Error(`Already added: ${href}`);
	return href;
}

async function feedTitle(ctx: PluginContext, href: string): Promise<string> {
	let feed: Feed;
	try {
		feed = await fetchFeed(ctx, href);
	} catch (error) {
		throw new Error(`Couldn't load ${href}: ${error instanceof Error ? error.message : error}`);
	}
	if (!feed.title && feed.items.length === 0) {
		throw new Error(`${href} doesn't look like an RSS or Atom feed`);
	}
	return feed.title || new URL(href).hostname;
}

async function addFeed(ctx: PluginContext, name: string, url: string, enabled = true) {
	const href = await newFeedUrl(ctx, url);
	const title = await feedTitle(ctx, href);
	const record: FeedRecord = {
		name: name.trim() || title,
		url: href,
		enabled,
		createdAt: new Date().toISOString(),
	};
	await feedStore(ctx).put(crypto.randomUUID(), record);
	return record;
}

async function editFeed(ctx: PluginContext, id: string, name: string, url: string) {
	const record = await feedStore(ctx).get(id);
	if (!record) throw new Error("That feed no longer exists");
	const sameUrl = absoluteUrl(url.trim(), "about:blank") === record.url;
	const href = sameUrl ? record.url : await newFeedUrl(ctx, url);
	const title = sameUrl && name.trim() ? "" : await feedTitle(ctx, href);
	const updated: FeedRecord = sameUrl
		? { ...record, name: name.trim() || title }
		: { name: name.trim() || title, url: href, enabled: record.enabled, createdAt: record.createdAt };
	await feedStore(ctx).put(id, updated);
	return updated;
}

async function importLegacyList(ctx: PluginContext) {
	const legacy = await ctx.settings.get<string>("feeds");
	if (legacy === null) return;
	for (const raw of legacy.split("\n")) {
		const line = raw.trim();
		if (!line) continue;
		const paused = line.startsWith("#");
		const entry = paused ? line.slice(1).trim() : line;
		const bar = entry.lastIndexOf("|");
		const [name, url] = bar === -1 ? ["", entry] : [entry.slice(0, bar), entry.slice(bar + 1)];
		try {
			await addFeed(ctx, name, url, !paused);
		} catch (error) {
			ctx.log.warn("Couldn't import feed from settings", { line, error: String(error) });
		}
	}
	await ctx.settings.delete("feeds");
}

const PAGE_PATH = "/feeds";
const ADMIN_ROLE = 50;

async function renderPage(ctx: PluginContext, isAdmin: boolean, editing?: string): Promise<Block[]> {
	const feeds = await listFeeds(ctx);
	const edited = feeds.find(({ id }) => id === editing);
	const failing = feeds.filter(({ data }) => data.enabled && data.lastError);
	const active = feeds.filter(({ data }) => data.enabled).length;
	const hasWebhook = Boolean(await ctx.settings.get<string>("webhookUrl"));

	const blocks: Block[] = [
		{ type: "header", text: "Discord feeds" },
		{
			type: "context",
			text: "New posts from active feeds are announced on Discord every 10 minutes. A newly added feed announces its latest post first.",
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
	blocks.push(
		{
			type: "stats",
			items: [
				{ label: "Feeds", value: feeds.length },
				{ label: "Active", value: active },
				{ label: "Paused", value: feeds.length - active },
				{ label: "Failing", value: failing.length, trend: failing.length > 0 ? "down" : "neutral" },
			],
		},
	);
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
	blocks.push(
		{
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
							{ key: "toggle", label: "", format: "element" },
							{ key: "remove", label: "", format: "element" },
						] as const)
					: []),
			],
			rows: feeds.map(({ id, data }) => ({
				name: data.name,
				url: data.url,
				status: !data.enabled ? "Paused" : data.lastError ? "Failing" : "Active",
				lastPostAt: data.lastPostAt ?? "",
				lastPostTitle: data.lastPostTitle ?? "—",
				...(isAdmin && {
					edit: { type: "button", action_id: "edit", label: "Edit", style: "secondary", value: id },
					toggle: {
						type: "button",
						action_id: "toggle",
						label: data.enabled ? "Pause" : "Resume",
						style: "secondary",
						value: id,
					},
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
		},
	);
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

const editedId = (interaction: BlockInteraction) =>
	interaction.type === "form_submit" && interaction.action_id === "save"
		? interaction.block_id?.replace(/^edit:/, "")
		: undefined;

async function handleInteraction(
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
	if (interaction.action_id === "toggle") {
		const record = await feedStore(ctx).get(id);
		if (!record) throw new Error("That feed no longer exists");
		await feedStore(ctx).put(id, { ...record, enabled: !record.enabled });
		return { toast: { message: `${record.enabled ? "Paused" : "Resumed"} ${record.name}`, type: "success" } };
	}
	if (interaction.action_id === "remove") {
		const record = await feedStore(ctx).get(id);
		await feedStore(ctx).delete(id);
		return { toast: { message: `Removed ${record?.name ?? "feed"}`, type: "success" } };
	}
	if (interaction.action_id === "poll") {
		if (!(await ctx.settings.get<string>("webhookUrl"))) {
			throw new Error("Set the Discord webhook URL in the plugin settings first");
		}
		const announced = Object.values(await pollAll(ctx)).flat().length;
		return {
			toast: {
				message: announced > 0 ? `Announced ${announced} new post${announced === 1 ? "" : "s"}` : "No new posts",
				type: "info",
			},
		};
	}
	return {};
}

export function createPlugin() {
	return definePlugin({
		id: "feeds",
		version: "1.0.0",
		// Admins add arbitrary feed hosts; ctx.http still blocks private targets.
		capabilities: ["network:request:unrestricted"],
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
					await importLegacyList(ctx);
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
				handler: async (ctx) => {
					await importLegacyList(ctx);
					return { announced: await pollAll(ctx) };
				},
			},
		},
	});
}
