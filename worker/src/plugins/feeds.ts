import { definePlugin } from "emdash";
import type { PluginContext } from "emdash";
import { XMLParser } from "fast-xml-parser";

const SEEN_LIMIT = 500;
// Stops a feed that re-keys its GUIDs from flooding the channel.
const MAX_NEW_PER_FEED = 5;
const SUMMARY_LENGTH = 300;
const WORDS_PER_MINUTE = 225;
const EMBED_COLOR = 0x499fbf;
const DEFAULT_BOT_NAME = "Inovus Radar";
const DEFAULT_BOT_AVATAR = "https://inovuslabs.org/apple-touch-icon.png";

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

interface Bot {
	webhookUrl: string;
	username: string;
	avatarUrl: string;
}

// Discord can't show .ico favicons; Google's service returns a PNG.
const faviconOf = (site: string) =>
	`https://www.google.com/s2/favicons?sz=128&domain=${new URL(site).hostname}`;

async function announce(ctx: PluginContext, bot: Bot, feed: Feed, feedName: string, item: FeedItem) {
	const footer = [item.author, readingTime(item.content)].filter(Boolean).join(" · ");
	const target = new URL(bot.webhookUrl);
	target.searchParams.set("wait", "true");
	const res = await ctx.http!.fetch(target.href, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			username: bot.username,
			avatar_url: bot.avatarUrl,
			embeds: [
				{
					color: EMBED_COLOR,
					author: { name: feedName.slice(0, 256), url: feed.link, icon_url: faviconOf(feed.link) },
					title: (item.title || item.link).slice(0, 256),
					url: item.link || undefined,
					description: item.summary || undefined,
					image: item.image ? { url: item.image } : undefined,
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

function parseFeedList(value: string): { name: string; url: string }[] {
	return value
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"))
		.map((line) => {
			const bar = line.lastIndexOf("|");
			return bar === -1
				? { name: "", url: line }
				: { name: line.slice(0, bar).trim(), url: line.slice(bar + 1).trim() };
		})
		.filter(({ url }) => URL.canParse(url));
}

async function pollFeed(ctx: PluginContext, bot: Bot, name: string, url: string) {
	const res = await ctx.http!.fetch(url, {
		headers: {
			Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
			"User-Agent": "InovusLabsFeeds/1.0 (+https://kiosk-cms.inovuslabs.org)",
		},
	});
	if (!res.ok) throw new Error(`Feed returned ${res.status}`);
	const parsed = parseFeed(await res.text());
	const feed = { ...parsed, link: absoluteUrl(parsed.link, url) ?? new URL(url).origin };
	const items = feed.items
		.filter((item) => item.id)
		.map((item) => {
			const link = absoluteUrl(item.link, url) ?? "";
			const image = item.image ?? firstImage(item.content);
			return { ...item, link, image: image && absoluteUrl(image, link || url) };
		})
		.sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));

	const key = `seen:${url}`;
	const previous = await ctx.kv.get<string[]>(key);
	const seen = new Set(previous ?? []);
	const unseen = items.filter((item) => !seen.has(item.id));
	const toAnnounce = unseen.slice(0, previous === null ? 1 : MAX_NEW_PER_FEED).reverse();
	const handled = new Set(unseen.map((item) => item.id));

	const announced: string[] = [];
	let failure: unknown;
	for (const [i, item] of toAnnounce.entries()) {
		try {
			await announce(ctx, bot, feed, name || feed.title || new URL(url).hostname, item);
			announced.push(item.title);
		} catch (error) {
			if (error instanceof Rejected) {
				ctx.log.error("Discord rejected feed post; skipping it", {
					url,
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

export function createPlugin() {
	return definePlugin({
		id: "feeds",
		version: "1.0.0",
		// Admins add arbitrary feed hosts; ctx.http still blocks private targets.
		capabilities: ["network:request:unrestricted"],
		admin: {
			settingsSchema: {
				feeds: {
					type: "string",
					multiline: true,
					label: "Feeds",
					description:
						"One per line: Name | https://example.com/feed (or just the URL). Start a line with # to pause it.",
				},
				webhookUrl: {
					type: "secret",
					label: "Discord webhook URL",
					description: "Channel webhook that new feed posts are announced to.",
				},
				botName: {
					type: "string",
					label: "Bot name",
					description: `Name the posts appear under. Defaults to ${DEFAULT_BOT_NAME}.`,
					default: DEFAULT_BOT_NAME,
				},
				botAvatarUrl: {
					type: "url",
					label: "Bot avatar URL",
					description: "PNG, JPEG or GIF (not SVG). Defaults to the Inovus Labs logo.",
					default: DEFAULT_BOT_AVATAR,
				},
			},
		},
		routes: {
			poll: {
				handler: async (ctx) => {
					const webhookUrl = await ctx.settings.get<string>("webhookUrl");
					if (!webhookUrl) {
						ctx.log.warn("No Discord webhook URL set; skipping feed poll");
						return { announced: {} };
					}

					const bot: Bot = {
						webhookUrl,
						username: (await ctx.settings.get<string>("botName")) || DEFAULT_BOT_NAME,
						avatarUrl: (await ctx.settings.get<string>("botAvatarUrl")) || DEFAULT_BOT_AVATAR,
					};
					const feeds = parseFeedList((await ctx.settings.get<string>("feeds")) ?? "");
					const announced: Record<string, string[]> = {};
					for (const { name, url } of feeds) {
						try {
							const titles = await pollFeed(ctx, bot, name, url);
							if (titles.length > 0) announced[name || url] = titles;
						} catch (error) {
							if (error instanceof RateLimited) {
								ctx.log.warn("Discord rate limited; resuming next poll");
								break;
							}
							ctx.log.error("Feed poll failed", { feed: name, url, error: String(error) });
						}
					}
					if (Object.keys(announced).length > 0) ctx.log.info("Announced feed posts", { announced });
					return { announced };
				},
			},
		},
	});
}
