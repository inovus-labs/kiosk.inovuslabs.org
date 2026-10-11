import { XMLParser } from "fast-xml-parser";

const SUMMARY_LENGTH = 300;
const WORDS_PER_MINUTE = 225;

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	textNodeName: "#text",
	htmlEntities: true,
});

export interface EntryDetails {
	summary: string;
	author: string;
	image?: string;
	readingTime?: string;
}

export interface FeedEntry {
	id: string;
	title: string;
	link: string;
	published?: string;
	details: () => EntryDetails;
}

export interface Feed {
	title: string;
	link: string;
	entries: FeedEntry[];
}

export interface Validators {
	etag?: string;
	lastModified?: string;
}

export type FetchResult =
	| { notModified: true }
	| { notModified: false; feed: Feed; validators: Validators };

interface RawEntry {
	id: string;
	title: string;
	link: string;
	published?: string;
	summaryHtml: string;
	contentHtml: string;
	author: string;
	image?: string;
}

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

export function absoluteUrl(value: string, base: string): string | undefined {
	try {
		const url = new URL(value, base);
		return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
	} catch {
		return undefined;
	}
}

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
	lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
	ndash: "–", mdash: "—", hellip: "…",
};

// HTML-typed feed text is entity-escaped twice, so the XML parser only undoes one level.
export function decodeEntities(value: string): string {
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

function mediaImage(entry: Record<string, unknown>): string | undefined {
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

function atomEntry(entry: Record<string, unknown>): RawEntry {
	const link = atomLink(entry.link);
	return {
		id: text(entry.id) || link,
		title: decodeEntities(text(entry.title)),
		link,
		published: toIso(text(entry.published) || text(entry.updated)),
		summaryHtml: text(entry.summary),
		contentHtml: text(entry.content),
		author: text((list(entry.author)[0] as Record<string, unknown> | undefined)?.name),
		image: mediaImage(entry),
	};
}

function rssEntry(item: Record<string, unknown>): RawEntry {
	const link = text(item.link);
	return {
		id: text(item.guid) || link || text(item.title),
		title: decodeEntities(text(item.title)),
		link,
		published: toIso(text(item.pubDate) || text(item["dc:date"])),
		summaryHtml: text(item.description),
		contentHtml: text(item["content:encoded"]),
		author: text(item["dc:creator"]) || text(item.author),
		image: mediaImage(item),
	};
}

export function parseFeed(xml: string, url: string): Feed {
	const doc = parser.parse(xml);
	const atom = doc.feed;
	const channel = atom ?? doc.rss?.channel ?? doc["rdf:RDF"]?.channel ?? {};
	const raw = atom
		? list<Record<string, unknown>>(atom.entry).map(atomEntry)
		: list<Record<string, unknown>>(doc.rss?.channel?.item ?? doc["rdf:RDF"]?.item).map(rssEntry);

	return {
		title: decodeEntities(text(channel.title)),
		link: absoluteUrl(atom ? atomLink(atom.link) : text(channel.link), url) ?? new URL(url).origin,
		entries: raw
			.filter((entry) => entry.id)
			.map((entry): FeedEntry => {
				const link = absoluteUrl(entry.link, url) ?? "";
				return {
					id: entry.id,
					title: entry.title,
					link,
					published: entry.published,
					details: () => {
						const image = entry.image ?? firstImage(entry.contentHtml);
						return {
							summary: summarize(entry.summaryHtml || entry.contentHtml),
							author: entry.author,
							image: image ? absoluteUrl(image, link || url) : undefined,
							readingTime: readingTime(entry.contentHtml),
						};
					},
				};
			})
			.sort((a, b) => (b.published ?? "").localeCompare(a.published ?? "")),
	};
}

export async function fetchFeed(url: string, validators: Validators = {}): Promise<FetchResult> {
	const headers: Record<string, string> = {
		Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
		"User-Agent": "InovusLabsFeeds/1.0 (+https://kiosk-cms.inovuslabs.org)",
	};
	if (validators.etag) headers["If-None-Match"] = validators.etag;
	if (validators.lastModified) headers["If-Modified-Since"] = validators.lastModified;

	const res = await fetch(url, { headers });
	if (res.status === 304) return { notModified: true };
	if (!res.ok) throw new Error(`Feed returned ${res.status}`);
	return {
		notModified: false,
		feed: parseFeed(await res.text(), url),
		validators: {
			etag: res.headers.get("ETag") ?? undefined,
			lastModified: res.headers.get("Last-Modified") ?? undefined,
		},
	};
}
