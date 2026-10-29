import { env } from "cloudflare:workers";

export interface GhostAuthor {
	name: string;
	bluesky?: string | null;
	linkedin?: string | null;
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

// Platform `name` uses KV binding `NAME` (`post:<Ghost id>` → address, plus its login) and var `NAME_DRY_RUN`.
export interface Platform<Draft extends object = object> {
	id: string;
	prepare(post: GhostPost): Promise<Draft>;
	publish(post: GhostPost, draft: Draft): Promise<string>;
}

export interface Cover {
	bytes: ArrayBuffer;
	type: string;
}

const COVER_WIDTH = 1200;

const segmenter = new Intl.Segmenter();
export const graphemes = (s: string) => [...segmenter.segment(s)].map((g) => g.segment);

export function truncate(text: string, max: number): string {
	const chars = graphemes(text);
	if (chars.length <= max) return text;
	const cut = chars.slice(0, max - 1).join("");
	const atWord = cut.slice(0, cut.lastIndexOf(" "));
	return `${(atWord.length > cut.length * 0.6 ? atWord : cut).trimEnd()}…`;
}

export const excerpt = (post: GhostPost) => (post.custom_excerpt || post.excerpt || "").replace(/\s+/g, " ").trim();

export function hashtag(name: string): string | undefined {
	const tag = name
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
		.map((word) => word[0].toUpperCase() + word.slice(1))
		.join("");
	return tag && !/^\d+$/.test(tag) && tag.length <= 64 ? tag : undefined;
}

export function hashtags(post: GhostPost, max: number): string[] {
	return [...new Set((post.tags ?? []).filter((t) => t.visibility !== "internal").map((t) => hashtag(t.name)))]
		.filter((t): t is string => !!t)
		.slice(0, max);
}

export function list(items: string[]): string[] {
	if (items.length < 2) return items;
	return [...items.slice(0, -1).flatMap((item, i) => (i ? [", ", item] : [item])), " & ", items.at(-1)!];
}

export async function loadCover(
	url: string | null | undefined,
	{ accept = (type: string) => type.startsWith("image/"), maxBytes = Infinity } = {},
): Promise<Cover | undefined> {
	if (!url) return;
	try {
		const res = await fetch(url);
		if (!res.ok || !res.body) return;
		const type = res.headers.get("content-type")?.split(";")[0] ?? "";
		const size = Number(res.headers.get("content-length"));
		if (accept(type) && size > 0 && size <= maxBytes) return { bytes: await res.arrayBuffer(), type };
		const output = await env.IMAGES.input(res.body)
			.transform({ width: COVER_WIDTH, fit: "scale-down" })
			.output({ format: "image/jpeg", quality: 80 });
		const bytes = await output.response().arrayBuffer();
		return bytes.byteLength <= maxBytes ? { bytes, type: "image/jpeg" } : undefined;
	} catch (error) {
		console.warn(`share: no cover from ${url}:`, error);
	}
}
