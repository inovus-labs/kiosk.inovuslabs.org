// No Worker imports, so the backfill script can build the same posts.

export interface GhostAuthor {
	name: string;
	bluesky?: string | null;
}

export interface GhostTag {
	name: string;
	visibility?: string;
}

export interface GhostPost {
	id: string;
	title: string;
	url: string;
	status?: string;
	visibility?: string;
	published_at?: string | null;
	updated_at?: string | null;
	plaintext?: string | null;
	html?: string | null;
	custom_excerpt?: string | null;
	excerpt?: string | null;
	feature_image?: string | null;
	authors?: GhostAuthor[];
	tags?: GhostTag[];
}

export interface Facet {
	index: { byteStart: number; byteEnd: number };
	features: Record<string, string>[];
}

export interface PostDraft {
	text: string;
	facets: Facet[];
	description: string;
}

const MAX_GRAPHEMES = 300;
const MAX_TAGS = 3;
const MAX_DESCRIPTION = 300;

const segmenter = new Intl.Segmenter();
const encoder = new TextEncoder();
const graphemes = (s: string) => [...segmenter.segment(s)].map((g) => g.segment);
const byteLength = (s: string) => encoder.encode(s).length;

/** Authors type their Bluesky address as `name.example`, `@name.example` or a bsky.app profile link. */
export function blueskyHandle(value?: string | null): string | undefined {
	const handle = value
		?.trim()
		.replace(/^https?:\/\/(www\.)?bsky\.app\/profile\//i, "")
		.replace(/^@/, "")
		.replace(/\/.*$/, "")
		.toLowerCase();
	return handle && /^([a-z0-9-]+\.)+[a-z][a-z0-9-]*$/.test(handle) ? handle : undefined;
}

export function hashtag(name: string): string | undefined {
	const tag = name
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
		.map((word) => word[0].toUpperCase() + word.slice(1))
		.join("");
	return tag && !/^\d+$/.test(tag) && tag.length <= 64 ? tag : undefined;
}

function truncate(text: string, max: number): string {
	const chars = graphemes(text);
	if (chars.length <= max) return text;
	const cut = chars.slice(0, max - 1).join("");
	const atWord = cut.slice(0, cut.lastIndexOf(" "));
	return `${(atWord.length > cut.length * 0.6 ? atWord : cut).trimEnd()}…`;
}

class RichText {
	text = "";
	facets: Facet[] = [];

	add(segment: string, feature?: Record<string, string>) {
		if (feature) {
			const byteStart = byteLength(this.text);
			this.facets.push({ index: { byteStart, byteEnd: byteStart + byteLength(segment) }, features: [feature] });
		}
		this.text += segment;
		return this;
	}
}

function list(items: string[]): string[] {
	if (items.length < 2) return items;
	return [...items.slice(0, -1).flatMap((item, i) => (i ? [", ", item] : [item])), " & ", items.at(-1)!];
}

/** `dids` maps each author's normalised Bluesky handle to its DID; authors without one are credited by name. */
export function buildPost(post: GhostPost, dids: Map<string, string>): PostDraft {
	const summary = (post.custom_excerpt || post.excerpt || "").replace(/\s+/g, " ").trim();
	const credits = (post.authors ?? []).map((author) => {
		const handle = blueskyHandle(author.bluesky);
		const did = handle && dids.get(handle);
		return did ? { text: `@${handle}`, did } : { text: author.name };
	});
	const tags = [
		...new Set((post.tags ?? []).filter((t) => t.visibility !== "internal").map((t) => hashtag(t.name))),
	]
		.filter((t): t is string => !!t)
		.slice(0, MAX_TAGS);

	const footer = (withTags: boolean) => {
		const rich = new RichText();
		if (credits.length) {
			rich.add("✍️ by ");
			for (const part of list(credits.map((c) => c.text))) {
				const credit = credits.find((c) => c.text === part);
				rich.add(part, credit?.did ? { $type: "app.bsky.richtext.facet#mention", did: credit.did } : undefined);
			}
		}
		if (withTags && tags.length) {
			if (rich.text) rich.add("\n");
			tags.forEach((tag, i) => (i ? rich.add(" ") : rich).add(`#${tag}`, { $type: "app.bsky.richtext.facet#tag", tag }));
		}
		return rich;
	};

	let tail = footer(true);
	if (graphemes(tail.text).length > MAX_GRAPHEMES / 2) tail = footer(false);
	const separator = tail.text ? "\n\n" : "";
	const body = truncate(summary || post.title, MAX_GRAPHEMES - graphemes(separator + tail.text).length);

	const rich = new RichText().add(body + separator);
	const offset = byteLength(rich.text);
	return {
		text: rich.text + tail.text,
		facets: tail.facets.map((f) => ({
			...f,
			index: { byteStart: f.index.byteStart + offset, byteEnd: f.index.byteEnd + offset },
		})),
		description: truncate(summary, MAX_DESCRIPTION),
	};
}

// The blog publishes in English and Malayalam; Bluesky uses `langs` for language filters and translation.
function language(text: string): string {
	const malayalam = text.match(/[ഀ-ൿ]/g)?.length ?? 0;
	const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
	return malayalam > latin ? "ml" : "en";
}

/**
 * The `app.bsky.feed.post` record; `thumb` is the blob ref returned by uploadBlob. `associatedRefs` (the post's
 * Standard.site document and publication) turn the link card into a publication card.
 */
export function postRecord(
	post: GhostPost,
	draft: PostDraft,
	thumb: unknown,
	createdAt: string,
	associatedRefs: { uri: string; cid: string }[] = [],
) {
	return {
		$type: "app.bsky.feed.post",
		text: draft.text,
		facets: draft.facets,
		langs: [language(`${post.title} ${draft.description}`)],
		embed: {
			$type: "app.bsky.embed.external",
			external: {
				uri: post.url,
				title: post.title,
				description: draft.description,
				...(thumb ? { thumb } : {}),
				...(associatedRefs.length && { associatedRefs }),
			},
		},
		createdAt,
	};
}
