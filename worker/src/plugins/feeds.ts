import { definePlugin } from "emdash";
import type { PluginContext } from "emdash";
import { XMLParser } from "fast-xml-parser";

const SEEN_LIMIT = 500;
// Stops a feed that re-keys its GUIDs from flooding the channel.
const MAX_NEW_PER_FEED = 5;
const SUMMARY_LENGTH = 300;

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

function summarize(html: string): string {
	const plain = decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
	return plain.length > SUMMARY_LENGTH ? `${plain.slice(0, SUMMARY_LENGTH - 1).trimEnd()}…` : plain;
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

function parseFeed(xml: string): { title: string; items: FeedItem[] } {
	const doc = parser.parse(xml);

	if (doc.feed) {
		const feed = doc.feed;
		return {
			title: text(feed.title),
			items: list<Record<string, unknown>>(feed.entry).map((entry) => {
				const links = list(entry.link as Record<string, unknown>[]);
				const link = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
				const href = link ? text(link["@_href"]) : "";
				return {
					id: text(entry.id) || href,
					title: decodeEntities(text(entry.title)),
					link: href,
					published: toIso(text(entry.published) || text(entry.updated)),
					summary: summarize(text(entry.summary) || text(entry.content)),
					author: text((list(entry.author)[0] as Record<string, unknown> | undefined)?.name),
					image: imageOf(entry),
				};
			}),
		};
	}

	const channel = doc.rss?.channel ?? doc["rdf:RDF"]?.channel ?? {};
	const items = doc.rss?.channel?.item ?? doc["rdf:RDF"]?.item;
	return {
		title: text(channel.title),
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
			};
		}),
	};
}

async function announce(ctx: PluginContext, webhookUrl: string, feedName: string, item: FeedItem) {
	const target = new URL(webhookUrl);
	target.searchParams.set("wait", "true");
	const res = await ctx.http!.fetch(target.href, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			embeds: [
				{
					title: (item.title || item.link).slice(0, 256),
					url: item.link || undefined,
					description: item.summary || undefined,
					author: { name: (item.author ? `${feedName} · ${item.author}` : feedName).slice(0, 256) },
					timestamp: item.published,
					image: item.image ? { url: item.image } : undefined,
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

async function pollFeed(ctx: PluginContext, webhookUrl: string, name: string, url: string) {
	const res = await ctx.http!.fetch(url, {
		headers: {
			Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
			"User-Agent": "InovusLabsFeeds/1.0 (+https://kiosk-cms.inovuslabs.org)",
		},
	});
	if (!res.ok) throw new Error(`Feed returned ${res.status}`);
	const feed = parseFeed(await res.text());
	const items = feed.items
		.filter((item) => item.id)
		.map((item) => ({
			...item,
			link: absoluteUrl(item.link, url) ?? "",
			image: item.image && absoluteUrl(item.image, url),
		}))
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
			await announce(ctx, webhookUrl, name || feed.title, item);
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

					const feeds = parseFeedList((await ctx.settings.get<string>("feeds")) ?? "");
					const announced: Record<string, string[]> = {};
					for (const { name, url } of feeds) {
						try {
							const titles = await pollFeed(ctx, webhookUrl, name, url);
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
