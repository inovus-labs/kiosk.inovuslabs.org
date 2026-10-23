import { env, waitUntil } from "cloudflare:workers";
import { hashtag, truncate, type GhostAuthor, type GhostPost } from "./bluesky-post";

const API = "https://api.linkedin.com/rest";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
// LinkedIn sunsets each version a year after release; bump this before then.
const VERSION = "202610";
const TOKEN_KEY = "token";
const MAX_TAGS = 3;
const MAX_DESCRIPTION = 300;
const THUMB_WIDTH = 1200;
const DAY = 86_400_000;

interface Token {
	access_token: string;
	expires_at: number;
	refresh_token?: string;
}

/** Post a newly published Ghost post to the LinkedIn page after the response; failures are only logged. */
export function announceOnLinkedIn(post: GhostPost, note: Promise<string | undefined>) {
	waitUntil(announce(post, note).catch((error) => console.error(`linkedin: post ${post.id} failed:`, error)));
}

async function announce(post: GhostPost, note: Promise<string | undefined>) {
	const key = `post:${post.id}`;
	const existing = await env.LINKEDIN.get(key);
	if (existing) return console.log(`linkedin: post ${post.id} already at ${existing}`);

	const dryRun = env.LINKEDIN_DRY_RUN === "true";
	// A dry run still looks up mentions when the app is authorized, but needs nothing else.
	const token = dryRun ? await accessToken().catch(() => undefined) : await accessToken();
	const people = token ? await resolvePeople(token, post.authors ?? []) : new Map<string, string>();
	const text = commentary(post, people, await note);
	const description = truncate((post.custom_excerpt || post.excerpt || "").replace(/\s+/g, " ").trim(), MAX_DESCRIPTION);
	const thumb = await loadThumb(post.feature_image);
	if (dryRun || !token) {
		const thumbInfo = thumb && { bytes: thumb.byteLength };
		return console.log("linkedin: dry run", JSON.stringify({ post: post.id, commentary: text, description, thumb: thumbInfo }));
	}

	const res = await api(token, "/posts", {
		author: organization(),
		commentary: text,
		visibility: "PUBLIC",
		distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
		content: {
			article: {
				source: post.url,
				title: post.title,
				...(description && { description }),
				...(thumb && { thumbnail: await uploadImage(token, thumb) }),
			},
		},
		lifecycleState: "PUBLISHED",
		isReshareDisabledByAuthor: false,
	});
	const urn = res.headers.get("x-restli-id");
	if (!urn) throw new Error("post created without an id");
	await env.LINKEDIN.put(key, urn);
	console.log(`linkedin: posted ${post.id} as https://www.linkedin.com/feed/update/${urn}/`);
}

// Characters that mean something in LinkedIn's "little" text format must be escaped to show as typed.
const escape = (text: string) => text.replace(/[|{}@[\]()<>#\\*_~]/g, "\\$&");

/** Ghost keeps the profile's vanity name (`in/` dropped) and pages as `company/…`; links are accepted too. */
export function linkedinVanity(value?: string | null): string | undefined {
	const vanity = value
		?.trim()
		.replace(/^(https?:\/\/)?([\w-]+\.)?linkedin\.com\//i, "")
		.replace(/[?#].*$/, "")
		.replace(/\/+$/, "")
		.replace(/^in\//i, "");
	return vanity && /^[\p{L}\p{N}-]{3,100}$/u.test(vanity) ? vanity : undefined;
}

// Only members who follow the page can be found, and only with the restricted r_organization_followers permission.
async function resolvePeople(token: string, authors: GhostAuthor[]): Promise<Map<string, string>> {
	const vanities = [...new Set(authors.map((a) => linkedinVanity(a.linkedin)).filter((v): v is string => !!v))];
	const resolved = await Promise.all(
		vanities.map(async (vanity) => {
			const query = new URLSearchParams({
				q: "vanityUrlAsOrganization",
				vanityUrl: `https://www.linkedin.com/in/${vanity}`,
				organization: organization(),
			});
			const res = await fetch(`${API}/vanityUrl?${query}`, { headers: headers(token) });
			if (!res.ok) console.warn(`linkedin: no mention for ${vanity}: ${res.status} ${(await res.text()).slice(0, 200)}`);
			const data = res.ok ? ((await res.json()) as { elements?: { member?: string }[] }) : {};
			return [vanity, data.elements?.[0]?.member] as const;
		}),
	);
	return new Map(resolved.filter((entry): entry is [string, string] => !!entry[1]));
}

/**
 * The description, the author credit and hashtags from the public tags. `people` maps each author's LinkedIn vanity
 * name to its person URN; authors without one are credited by name. LinkedIn allows 3,000 characters.
 */
export function commentary(post: GhostPost, people: Map<string, string>, note = ""): string {
	const names = (post.authors ?? []).map((author) => {
		const vanity = linkedinVanity(author.linkedin);
		const urn = vanity && people.get(vanity);
		return urn ? `@[${escape(author.name)}](${urn})` : escape(author.name);
	});
	const credit = names.length > 1 ? `${names.slice(0, -1).join(", ")} & ${names.at(-1)}` : names[0];
	const tags = [...new Set((post.tags ?? []).filter((t) => t.visibility !== "internal").map((t) => hashtag(t.name)))]
		.filter((t): t is string => !!t)
		.slice(0, MAX_TAGS);
	return [escape(note.trim()), credit && `✍️ by ${credit}`, tags.map((t) => `#${t}`).join(" ")]
		.filter(Boolean)
		.join("\n\n");
}

const organization = () => `urn:li:organization:${env.LINKEDIN_ORGANIZATION}`;

// LinkedIn takes JPEG, PNG and GIF but not WebP, so every cover is re-encoded as a JPEG.
async function loadThumb(url?: string | null): Promise<ArrayBuffer | undefined> {
	if (!url) return;
	try {
		const res = await fetch(url);
		if (!res.ok || !res.body) return;
		const output = await env.IMAGES.input(res.body)
			.transform({ width: THUMB_WIDTH, fit: "scale-down" })
			.output({ format: "image/jpeg", quality: 85 });
		return await output.response().arrayBuffer();
	} catch (error) {
		console.warn(`linkedin: no thumbnail for ${url}:`, error);
	}
}

async function uploadImage(token: string, bytes: ArrayBuffer): Promise<string> {
	const res = await api(token, "/images?action=initializeUpload", { initializeUploadRequest: { owner: organization() } });
	const { value } = (await res.json()) as { value: { uploadUrl: string; image: string } };
	const upload = await fetch(value.uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: bytes });
	if (!upload.ok) throw new Error(`image upload failed: ${upload.status} ${(await upload.text()).slice(0, 200)}`);
	return value.image;
}

const headers = (token: string) => ({
	Authorization: `Bearer ${token}`,
	"LinkedIn-Version": VERSION,
	"X-Restli-Protocol-Version": "2.0.0",
});

async function api(token: string, path: string, body: unknown): Promise<Response> {
	const res = await fetch(`${API}${path}`, {
		method: "POST",
		headers: { ...headers(token), "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`${path} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
	return res;
}

// Access tokens last 60 days and the refresh token a year from the first sign-in; after that a page admin has to
// authorize the app again (see the README).
async function accessToken(): Promise<string> {
	const token = await env.LINKEDIN.get<Token>(TOKEN_KEY, "json");
	if (!token) throw new Error("not authorized yet");
	if (token.expires_at > Date.now() + DAY) return token.access_token;
	if (!token.refresh_token) throw new Error("access token expired and there is no refresh token");

	const res = await fetch(TOKEN_URL, {
		method: "POST",
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: token.refresh_token,
			client_id: env.LINKEDIN_CLIENT_ID,
			client_secret: env.LINKEDIN_CLIENT_SECRET,
		}),
	});
	if (!res.ok) throw new Error(`token refresh failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
	const data = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
	const next: Token = {
		access_token: data.access_token,
		expires_at: Date.now() + data.expires_in * 1000,
		refresh_token: data.refresh_token ?? token.refresh_token,
	};
	await env.LINKEDIN.put(TOKEN_KEY, JSON.stringify(next));
	return next.access_token;
}
