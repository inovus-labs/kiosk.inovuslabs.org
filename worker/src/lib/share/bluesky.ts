import { env } from "cloudflare:workers";
import {
	DID,
	DOCUMENT,
	PUBLICATION,
	PUBLICATION_KEY,
	documentKey,
	documentRecord,
	postPath,
	type StrongRef,
} from "../standard-site";
import { write, type Prompt } from "./ai";
import {
	excerpt,
	graphemes,
	hashtags,
	list,
	loadCover,
	truncate,
	type Cover,
	type GhostAuthor,
	type GhostPost,
	type Platform,
} from "./platform";

const PDS_ORIGIN = "https://pds.inovuslabs.org";
const PUBLIC_API = "https://public.api.bsky.app";
const SESSION_KEY = "session";
// Bluesky's blob limit is 1,000,000 bytes; leave room for rounding.
const THUMB_MAX_BYTES = 976_000;
const MAX_GRAPHEMES = 300;
const MAX_TAGS = 3;
const MAX_DESCRIPTION = 300;
const NOTE_MAX_GRAPHEMES = 240;

const SYSTEM = `You write the text of a Bluesky post that shares an article from Inovus Blogs, the blog of Inovus Labs, a student innovation community in Kerala.
Below the text, the post shows a link card with the article's title, excerpt, cover image, date and reading time.
Write a short, inviting description of the article, one or two sentences and at most 220 characters, that makes people want to read it: what it is about and what the reader gets from it, such as the story it tells, the question it answers, or what they will learn or build.
Rules:
- Ground it in what the article actually says, with at least one specific detail. Never invent facts, numbers or quotes.
- Don't repeat the title or copy the excerpt.
- Warm and natural, matching the article's tone; be careful with serious subjects. No clickbait, hype or empty praise such as "a must-read".
- Open with the subject itself, not a stock phrase: don't start with "Explore", "Learn", "Discover", "Dive into", "Find out" or "This article".
- Write in the same language as the article.
- No emoji, hashtags, @mentions, links or quotation marks.
Output only the description.`;

export const PROMPT: Prompt = { system: SYSTEM, articleChars: 4000, maxTokens: 300, clean: cleanNote };

export interface Facet {
	index: { byteStart: number; byteEnd: number };
	features: Record<string, string>[];
}

export interface PostDraft {
	text: string;
	facets: Facet[];
	description: string;
}

interface Draft extends PostDraft {
	thumb?: Cover;
}

interface Session {
	did: string;
	accessJwt: string;
	refreshJwt: string;
}

export const bluesky: Platform<Draft> = {
	id: "bluesky",

	async prepare(post) {
		const [note, dids, thumb] = await Promise.all([
			write(post, PROMPT),
			resolveAuthors(post.authors ?? []),
			loadCover(post.feature_image, { maxBytes: THUMB_MAX_BYTES }),
		]);
		return { ...buildPost(post, dids, note), thumb };
	},

	async publish(post, { thumb, ...draft }) {
		const session = await getSession();
		const blob = thumb && (await xrpc<{ blob: unknown }>("com.atproto.repo.uploadBlob", thumb.bytes, thumb.type)).blob;
		// The document comes first: the post's link card points at it and at the publication.
		const document = await xrpc<StrongRef>(
			"com.atproto.repo.putRecord",
			JSON.stringify({
				repo: session.did,
				collection: DOCUMENT,
				rkey: documentKey(post.published_at!, postPath(post)),
				record: documentRecord(post, blob),
			}),
			"application/json",
		);
		const { uri } = await xrpc<{ uri: string }>(
			"com.atproto.repo.createRecord",
			JSON.stringify({
				repo: session.did,
				collection: "app.bsky.feed.post",
				record: postRecord(post, draft, blob, new Date().toISOString(), [
					{ uri: document.uri, cid: document.cid },
					await publicationRef(),
				]),
			}),
			"application/json",
		);
		return uri;
	},
};

const encoder = new TextEncoder();
const byteLength = (s: string) => encoder.encode(s).length;

// Strips what the prompt forbids; undefined when nothing usable is left.
function cleanNote(raw: string): string | undefined {
	const note = raw
		.replace(/\p{Extended_Pictographic}️?/gu, "")
		.replace(/https?:\/\/\S+|[#@][\p{L}\p{N}_.-]+/gu, "")
		.replace(/["“”«»]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (!note) return;
	const chars = graphemes(note);
	if (chars.length <= NOTE_MAX_GRAPHEMES) return note;
	// Too long: keep whole sentences that fit, or give up rather than cut one mid-way.
	const kept = chars.slice(0, NOTE_MAX_GRAPHEMES).join("").match(/^.*[.!?।](?=\s|$)/s)?.[0];
	return kept?.trim() || undefined;
}

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

// Drops whole trailing sentences rather than cutting one off mid-way.
function fitSentences(text: string, max: number): string {
	if (graphemes(text).length <= max) return text;
	let kept = "";
	for (const sentence of text.split(/(?<=[.!?।])\s+/)) {
		const next = kept ? `${kept} ${sentence}` : sentence;
		if (graphemes(next).length > max) break;
		kept = next;
	}
	return kept || truncate(text, max);
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

/**
 * The post text: an optional `note` (the link card already shows the title, excerpt and date), then the author credit
 * and hashtags. `dids` maps each author's normalised Bluesky handle to its DID; authors without one are credited by
 * name.
 */
export function buildPost(post: GhostPost, dids: Map<string, string>, note = ""): PostDraft {
	const credits = (post.authors ?? []).map((author) => {
		const handle = blueskyHandle(author.bluesky);
		const did = handle && dids.get(handle);
		return did ? { text: `@${handle}`, did } : { text: author.name };
	});
	const tags = hashtags(post, MAX_TAGS);

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

	const room = (footerText: string) => MAX_GRAPHEMES - graphemes(`\n\n${footerText}`).length;
	const firstSentence = note.trim().split(/(?<=[.!?।])\s+/)[0];
	let tail = footer(true);
	// Hashtags go before the description would have to be cut mid-sentence.
	if (graphemes(tail.text).length > MAX_GRAPHEMES / 2 || graphemes(firstSentence).length > room(tail.text)) {
		tail = footer(false);
	}
	const body = note.trim() && fitSentences(note.trim(), room(tail.text));
	const separator = body && tail.text ? "\n\n" : "";

	const rich = new RichText().add(body + separator);
	const offset = byteLength(rich.text);
	return {
		text: rich.text + tail.text,
		facets: tail.facets.map((f) => ({
			...f,
			index: { byteStart: f.index.byteStart + offset, byteEnd: f.index.byteEnd + offset },
		})),
		description: truncate(excerpt(post), MAX_DESCRIPTION),
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
		// The article's own text where we have it: some Malayalam posts have English excerpts.
		langs: [language(`${post.title} ${post.plaintext || post.html?.replace(/<[^>]+>/g, " ") || draft.description}`)],
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

async function resolveAuthors(authors: GhostAuthor[]): Promise<Map<string, string>> {
	const handles = [...new Set(authors.map((a) => blueskyHandle(a.bluesky)).filter((h): h is string => !!h))];
	const resolved = await Promise.all(
		handles.map(async (handle) => {
			const res = await fetch(`${PUBLIC_API}/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`);
			const data = res.ok ? ((await res.json()) as { did?: string }) : {};
			return [handle, data.did] as const;
		}),
	);
	return new Map(resolved.filter((entry): entry is [string, string] => !!entry[1]));
}

function pds(method: string, init: RequestInit): Promise<Response> {
	return env.PDS.fetch(`${PDS_ORIGIN}/xrpc/${method}`, init);
}

// Fetched each time: the publication's CID changes whenever its record is edited.
async function publicationRef(): Promise<StrongRef> {
	const query = new URLSearchParams({ repo: DID, collection: PUBLICATION, rkey: PUBLICATION_KEY });
	const res = await pds(`com.atproto.repo.getRecord?${query}`, { method: "GET" });
	if (!res.ok) throw new Error(`publication record missing: ${res.status}`);
	const { uri, cid } = (await res.json()) as StrongRef;
	return { uri, cid };
}

async function saveSession(res: Response): Promise<Session> {
	if (!res.ok) throw new Error(`bluesky session failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
	const { did, accessJwt, refreshJwt } = (await res.json()) as Session;
	const session = { did, accessJwt, refreshJwt };
	await env.BLUESKY.put(SESSION_KEY, JSON.stringify(session));
	return session;
}

function login(): Promise<Session> {
	return pds("com.atproto.server.createSession", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD }),
	}).then(saveSession);
}

// Reusing the stored session avoids a password login (a bcrypt check) on every post.
async function getSession(): Promise<Session> {
	return (await env.BLUESKY.get<Session>(SESSION_KEY, "json")) ?? login();
}

async function refreshSession(session: Session): Promise<Session> {
	const res = await pds("com.atproto.server.refreshSession", {
		method: "POST",
		headers: { Authorization: `Bearer ${session.refreshJwt}` },
	});
	return res.ok ? saveSession(res) : login();
}

async function xrpc<T>(method: string, body: BodyInit, contentType: string): Promise<T> {
	const call = (session: Session) =>
		pds(method, {
			method: "POST",
			headers: { Authorization: `Bearer ${session.accessJwt}`, "Content-Type": contentType },
			body,
		});
	let res = await call(await getSession());
	if (res.status === 400 || res.status === 401) {
		const { error } = (await res.clone().json().catch(() => ({}))) as { error?: string };
		if (res.status === 401 || error === "ExpiredToken" || error === "InvalidToken") {
			res = await call(await refreshSession(await getSession()));
		}
	}
	if (!res.ok) throw new Error(`${method} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
	return res.json() as Promise<T>;
}
