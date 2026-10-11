import type { PluginContext, StorageCollection } from "emdash";
import { absoluteUrl, fetchFeed } from "../../lib/feed";

export interface FeedRecord {
	name: string;
	url: string;
	createdAt: string;
	color?: number;
	icon?: string;
	etag?: string;
	lastModified?: string;
	lastPostAt?: string;
	lastPostTitle?: string;
	lastError?: string;
}

export type FeedRow = { id: string; data: FeedRecord };

export const feedStore = (ctx: PluginContext) => ctx.storage.feeds as StorageCollection<FeedRecord>;

export async function listFeeds(ctx: PluginContext): Promise<FeedRow[]> {
	const rows: FeedRow[] = [];
	let cursor: string | undefined;
	do {
		const page = await feedStore(ctx).query({ orderBy: { name: "asc" }, limit: 100, cursor });
		rows.push(...page.items);
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return rows;
}

// Golden-angle steps keep each new feed's hue far from the ones before it.
export function feedColor(index: number): number {
	const hue = (index * 137.508) % 360;
	const channel = (n: number) => {
		const k = (n + hue / 30) % 12;
		return Math.round((0.55 - 0.2925 * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
	};
	return (channel(0) << 16) | (channel(8) << 8) | channel(4);
}

async function newFeedUrl(ctx: PluginContext, url: string): Promise<string> {
	const href = absoluteUrl(url.trim(), "about:blank");
	if (!href) throw new Error(`Not a valid http(s) URL: ${url}`);
	if ((await feedStore(ctx).count({ url: href })) > 0) throw new Error(`Already added: ${href}`);
	return href;
}

async function feedTitle(href: string): Promise<string> {
	let result;
	try {
		result = await fetchFeed(href);
	} catch (error) {
		throw new Error(`Couldn't load ${href}: ${error instanceof Error ? error.message : error}`);
	}
	const feed = result.notModified ? undefined : result.feed;
	if (!feed || (!feed.title && feed.entries.length === 0)) {
		throw new Error(`${href} doesn't look like an RSS or Atom feed`);
	}
	return feed.title || new URL(href).hostname;
}

export async function addFeed(ctx: PluginContext, name: string, url: string) {
	const href = await newFeedUrl(ctx, url);
	const title = await feedTitle(href);
	const record: FeedRecord = {
		name: name.trim() || title,
		url: href,
		createdAt: new Date().toISOString(),
		color: feedColor(await feedStore(ctx).count()),
	};
	await feedStore(ctx).put(crypto.randomUUID(), record);
	return record;
}

export async function editFeed(ctx: PluginContext, id: string, name: string, url: string) {
	const record = await feedStore(ctx).get(id);
	if (!record) throw new Error("That feed no longer exists");
	const sameUrl = absoluteUrl(url.trim(), "about:blank") === record.url;
	const href = sameUrl ? record.url : await newFeedUrl(ctx, url);
	const title = sameUrl && name.trim() ? "" : await feedTitle(href);
	const updated: FeedRecord = sameUrl
		? { ...record, name: name.trim() || title }
		: { name: name.trim() || title, url: href, createdAt: record.createdAt, color: record.color };
	await feedStore(ctx).put(id, updated);
	return updated;
}
