import type { PluginContext } from "emdash";
import { RateLimited, Rejected, sendEmbed } from "../../lib/discord";
import { absoluteUrl, decodeEntities, fetchFeed, type Feed, type FeedEntry } from "../../lib/feed";
import { feedColor, feedStore, listFeeds, type FeedRecord } from "./store";

const SEEN_LIMIT = 500;
// Stops a feed that re-keys its GUIDs from flooding the channel.
const MAX_NEW_PER_FEED = 5;

// Discord can't show .ico favicons; Google's service returns a PNG, or a 404 when a site has none.
async function faviconOf(site: string): Promise<string> {
	const url = `https://www.google.com/s2/favicons?sz=128&domain=${new URL(site).hostname}`;
	const res = await fetch(url).catch(() => null);
	return res?.ok ? url : "";
}

async function pageImage(link: string): Promise<string | undefined> {
	if (!link) return undefined;
	const res = await fetch(link).catch(() => null);
	if (!res?.ok) return undefined;
	const tag = (await res.text()).match(/<meta[^>]+["'](?:og:image|twitter:image)["'][^>]*>/i)?.[0];
	const content = tag?.match(/content=["']([^"']+)["']/i)?.[1];
	return content ? absoluteUrl(decodeEntities(content), link) : undefined;
}

async function embedFor(record: FeedRecord, feed: Feed, entry: FeedEntry) {
	const { summary, author, image, readingTime } = entry.details();
	const footer = [author, readingTime].filter(Boolean).join(" · ");
	const picture = image ?? (await pageImage(entry.link));
	return {
		color: record.color,
		author: { name: record.name.slice(0, 256), url: feed.link, icon_url: record.icon || undefined },
		title: (entry.title || entry.link).slice(0, 256),
		url: entry.link || undefined,
		description: summary || undefined,
		image: picture ? { url: picture } : undefined,
		footer: footer ? { text: footer.slice(0, 2048) } : undefined,
		timestamp: entry.published,
	};
}

async function pollFeed(
	ctx: PluginContext,
	webhookUrl: string,
	record: FeedRecord,
): Promise<{ posts: FeedEntry[]; update: Partial<FeedRecord> }> {
	const result = await fetchFeed(record.url, { etag: record.etag, lastModified: record.lastModified });
	if (result.notModified) return { posts: [], update: {} };
	const { feed, validators } = result;

	const key = `seen:${record.url}`;
	const previous = await ctx.kv.get<string[]>(key);
	const seen = new Set(previous ?? []);
	const unseen = feed.entries.filter((entry) => !seen.has(entry.id));
	const toAnnounce = unseen.slice(0, previous === null ? 1 : MAX_NEW_PER_FEED).reverse();
	const handled = new Set(unseen.map((entry) => entry.id));

	const update: Partial<FeedRecord> = {};
	if (toAnnounce.length > 0 && record.icon === undefined) update.icon = await faviconOf(feed.link);
	const sender = { ...record, ...update };

	const posts: FeedEntry[] = [];
	let failure: unknown;
	for (const [i, entry] of toAnnounce.entries()) {
		try {
			await sendEmbed(webhookUrl, await embedFor(sender, feed, entry));
			posts.push(entry);
		} catch (error) {
			if (error instanceof Rejected) {
				ctx.log.error("Discord rejected feed post; skipping it", {
					url: record.url,
					item: entry.link,
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
	// Validators are saved only after a clean run, so a 304 can't hide posts that failed to send.
	if (failure) throw failure;
	if (validators.etag !== record.etag || validators.lastModified !== record.lastModified) {
		Object.assign(update, validators);
	}
	return { posts, update };
}

export async function pollAll(ctx: PluginContext): Promise<number> {
	const webhookUrl = await ctx.settings.get<string>("webhookUrl");
	if (!webhookUrl) {
		ctx.log.warn("No Discord webhook URL set; skipping feed poll");
		return 0;
	}

	const announced: Record<string, string[]> = {};
	for (const [index, { id, data }] of (await listFeeds(ctx)).entries()) {
		// Feeds added before colours existed get one on their first poll.
		let update: Partial<FeedRecord> = data.color === undefined ? { color: feedColor(index) } : {};
		const record = { ...data, ...update };
		try {
			const result = await pollFeed(ctx, webhookUrl, record);
			update = { ...update, ...result.update };
			const latest = result.posts.at(-1);
			if (latest) {
				announced[data.name] = result.posts.map((post) => post.title);
				update.lastPostAt = latest.published ?? new Date().toISOString();
				update.lastPostTitle = latest.title;
			}
			if (data.lastError) update.lastError = undefined;
		} catch (error) {
			if (error instanceof RateLimited) {
				ctx.log.warn("Discord rate limited; resuming next poll");
				break;
			}
			const message = error instanceof Error ? error.message : String(error);
			ctx.log.error("Feed poll failed", { feed: data.name, url: data.url, error: message });
			// Write only on change so a failing feed doesn't cost a D1 write every poll.
			if (message !== data.lastError) update.lastError = message.slice(0, 300);
		}
		if (Object.keys(update).length > 0) await feedStore(ctx).put(id, { ...record, ...update });
	}
	if (Object.keys(announced).length > 0) ctx.log.info("Announced feed posts", { announced });
	return Object.values(announced).flat().length;
}
