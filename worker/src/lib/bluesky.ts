import { env, waitUntil } from "cloudflare:workers";
import { blueskyHandle, buildPost, postRecord, type GhostAuthor, type GhostPost } from "./bluesky-post";
import {
	DID,
	DOCUMENT,
	PUBLICATION,
	PUBLICATION_KEY,
	documentKey,
	documentRecord,
	postPath,
	type StrongRef,
} from "./standard-site";

const PDS_ORIGIN = "https://pds.inovuslabs.org";
const PUBLIC_API = "https://public.api.bsky.app";
const SESSION_KEY = "session";
// Bluesky's blob limit is 1,000,000 bytes; leave room for rounding.
const THUMB_MAX_BYTES = 976_000;
const THUMB_WIDTH = 1200;

interface Session {
	did: string;
	accessJwt: string;
	refreshJwt: string;
}

interface Thumb {
	bytes: ArrayBuffer;
	type: string;
}

/** Post a newly published Ghost post to Bluesky after the response; failures are only logged. */
export function announceOnBluesky(post: GhostPost) {
	waitUntil(announce(post).catch((error) => console.error(`bluesky: post ${post.id} failed:`, error)));
}

async function announce(post: GhostPost) {
	const key = `post:${post.id}`;
	const existing = await env.BLUESKY.get(key);
	if (existing) return console.log(`bluesky: post ${post.id} already at ${existing}`);

	const draft = buildPost(post, await resolveAuthors(post.authors ?? []));
	const thumb = await loadThumb(post.feature_image);
	if (env.BLUESKY_DRY_RUN === "true") {
		const thumbInfo = thumb && { type: thumb.type, bytes: thumb.bytes.byteLength };
		return console.log("bluesky: dry run", JSON.stringify({ post: post.id, ...draft, thumb: thumbInfo }));
	}

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
			record: postRecord(post, draft, blob, new Date().toISOString(), [{ uri: document.uri, cid: document.cid }, await publicationRef()]),
		}),
		"application/json",
	);
	await env.BLUESKY.put(key, uri);
	console.log(`bluesky: posted ${post.id} as ${uri}`);
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

// Large covers are scaled down; anything that still won't fit is posted without a thumbnail.
async function loadThumb(url?: string | null): Promise<Thumb | undefined> {
	if (!url) return;
	try {
		const res = await fetch(url);
		if (!res.ok || !res.body) return;
		const type = res.headers.get("content-type")?.split(";")[0] ?? "";
		const size = Number(res.headers.get("content-length"));
		if (type.startsWith("image/") && size > 0 && size <= THUMB_MAX_BYTES) {
			return { bytes: await res.arrayBuffer(), type };
		}
		const output = await env.IMAGES.input(res.body)
			.transform({ width: THUMB_WIDTH, fit: "scale-down" })
			.output({ format: "image/jpeg", quality: 80 });
		const bytes = await output.response().arrayBuffer();
		return bytes.byteLength <= THUMB_MAX_BYTES ? { bytes, type: "image/jpeg" } : undefined;
	} catch (error) {
		console.warn(`bluesky: no thumbnail for ${url}:`, error);
	}
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
