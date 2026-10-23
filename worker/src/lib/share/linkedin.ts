import { env } from "cloudflare:workers";
import { write } from "./ai";
import { PROMPT } from "./bluesky";
import {
	excerpt,
	hashtags,
	list,
	loadCover,
	truncate,
	type Cover,
	type GhostAuthor,
	type GhostPost,
	type Platform,
} from "./platform";

const API = "https://api.linkedin.com/rest";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
// LinkedIn sunsets each version a year after release; bump this before then.
const VERSION = "202610";
const TOKEN_KEY = "token";
const MAX_TAGS = 3;
const MAX_DESCRIPTION = 300;
// The Images API takes no WebP; bigger covers are scaled down rather than uploaded whole.
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif"];
const THUMB_MAX_BYTES = 1_000_000;
const DAY = 86_400_000;

interface Draft {
	commentary: string;
	description: string;
	thumb?: Cover;
}

interface Token {
	access_token: string;
	expires_at: number;
	refresh_token?: string;
}

/** Posts on the Inovus Labs company page, as an article card with the cover as its thumbnail. */
export const linkedin: Platform<Draft> = {
	id: "linkedin",

	async prepare(post) {
		// Mentions need the app to be authorized; until then a dry run credits every author by name.
		const token = await accessToken().catch(() => undefined);
		const [text, people, thumb] = await Promise.all([
			write(post, PROMPT),
			token ? resolvePeople(token, post.authors ?? []) : new Map<string, string>(),
			loadCover(post.feature_image, { accept: (type) => IMAGE_TYPES.includes(type), maxBytes: THUMB_MAX_BYTES }),
		]);
		return { commentary: commentary(post, people, text), description: truncate(excerpt(post), MAX_DESCRIPTION), thumb };
	},

	async publish(post, draft) {
		const token = await accessToken();
		const res = await api(token, "/posts", {
			author: organization(),
			commentary: draft.commentary,
			visibility: "PUBLIC",
			distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
			content: {
				article: {
					source: post.url,
					title: post.title,
					...(draft.description && { description: draft.description }),
					...(draft.thumb && { thumbnail: await uploadImage(token, draft.thumb.bytes) }),
				},
			},
			lifecycleState: "PUBLISHED",
			isReshareDisabledByAuthor: false,
		});
		const urn = res.headers.get("x-restli-id");
		if (!urn) throw new Error("post created without an id");
		return urn;
	},
};

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
 * The AI-written text, the author credit and hashtags from the public tags. `people` maps each author's LinkedIn
 * vanity name to its person URN; authors without one are credited by name.
 */
export function commentary(post: GhostPost, people: Map<string, string>, text = ""): string {
	const names = (post.authors ?? []).map((author) => {
		const vanity = linkedinVanity(author.linkedin);
		const urn = vanity && people.get(vanity);
		return urn ? `@[${escape(author.name)}](${urn})` : escape(author.name);
	});
	const credit = list(names).join("");
	const tags = hashtags(post, MAX_TAGS);
	return [escape(text.trim()), credit && `✍️ by ${credit}`, tags.map((t) => `#${t}`).join(" ")]
		.filter(Boolean)
		.join("\n\n");
}

const organization = () => `urn:li:organization:${env.LINKEDIN_ORGANIZATION}`;

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
