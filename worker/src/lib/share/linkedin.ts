import { env } from "cloudflare:workers";
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

const API = "https://api.linkedin.com/rest";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
// Retired a year after release.
const VERSION = "202610";
const TOKEN_KEY = "token";
const MAX_TAGS = 3;
const MAX_DESCRIPTION = 300;
const TEXT_MAX_GRAPHEMES = 2000;
// No WebP.
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif"];
const THUMB_MAX_BYTES = 1_000_000;
const DAY = 86_400_000;

const SYSTEM = `You write LinkedIn posts for the company page of Inovus Labs, a student innovation community in Kerala, to share articles from its blog, Inovus Blogs.
Below the post, LinkedIn shows a link card with the article's title and cover image, and the post ends with the author credit and hashtags, so leave all of those out.
Write a post that makes people stop scrolling and want to read the article:
- Open with one strong line built on a striking detail, question or tension from the article. LinkedIn shows only the first two lines before "see more", so they must earn the click.
- Follow with two or three short paragraphs on what the article explores and what the reader takes away, with concrete details from it: a finding, a method, a number, an example or an argument.
- End with a short line that invites people to read it or to share their own view.
- Between 600 and 1,200 characters in all, short paragraphs separated by a blank line.
Rules:
- Ground everything in what the article says. Never invent facts, numbers, quotes or experiences.
- Speak as the page sharing someone's article, not as its author.
- Warm, clear and human, matching the article's tone; be careful with serious subjects. No clickbait, hype or buzzwords such as "game-changer", "revolutionary", "unlock" or "in today's fast-paced world", and no empty praise such as "a must-read".
- Don't open with "Excited to share", "Explore", "Discover", "Dive into" or "This article".
- Plain text only: no markdown, bold, headings or bullet symbols. At most two emoji, and only where they fit naturally.
- No hashtags, @mentions or links.
- Write in the same language as the article.
Output only the post.`;

export const PROMPT: Prompt = { system: SYSTEM, articleChars: 8000, maxTokens: 1200, clean: cleanText };

interface Draft {
	commentary: string;
	description: string;
	thumb?: Cover;
}

interface Person {
	urn: string;
	name: string;
}

interface Token {
	access_token: string;
	expires_at: number;
	refresh_token?: string;
}

export const linkedin: Platform<Draft> = {
	id: "linkedin",

	async prepare(post) {
		const token = await accessToken().catch(() => undefined);
		const [text, people, thumb] = await Promise.all([
			write(post, PROMPT),
			token ? resolvePeople(token, post.authors ?? []) : new Map<string, Person>(),
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

function cleanText(raw: string): string | undefined {
	const paragraphs = raw
		.replace(/https?:\/\/\S+/g, "")
		// Inline # and @ are escaped later.
		.replace(/^\s*(#[\p{L}\p{N}_]+\s*)+$/gmu, "")
		// Gemma sometimes slips CJK words into Malayalam.
		.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, "")
		.replace(/\*\*|__|^#+\s+|^\s*[-*•]\s+/gm, "")
		.split(/\n\s*\n/)
		.map((p) => p.replace(/\s+/g, " ").trim())
		.filter(Boolean);
	let text = "";
	for (const paragraph of paragraphs) {
		const next = text ? `${text}\n\n${paragraph}` : paragraph;
		if (graphemes(next).length > TEXT_MAX_GRAPHEMES) break;
		text = next;
	}
	return text || undefined;
}

// Reserved in LinkedIn's "little" text format.
const escape = (text: string) => text.replace(/[|{}@[\]()<>#\\*_~]/g, "\\$&");

// Ghost drops `in/`; pages are `company/…`.
export function linkedinVanity(value?: string | null): string | undefined {
	const vanity = value
		?.trim()
		.replace(/^(https?:\/\/)?([\w-]+\.)?linkedin\.com\//i, "")
		.replace(/[?#].*$/, "")
		.replace(/\/+$/, "")
		.replace(/^in\//i, "");
	return vanity && /^[\p{L}\p{N}-]{3,100}$/u.test(vanity) ? vanity : undefined;
}

// Finds page followers only.
async function resolvePeople(token: string, authors: GhostAuthor[]): Promise<Map<string, Person>> {
	const resolved = await Promise.all(
		authors.map(async (author) => {
			const vanity = linkedinVanity(author.linkedin);
			const urn = vanity && (await findMember(token, vanity));
			if (!urn) return;
			return [vanity, { urn, name: (await linkedinName(token, urn, author.name)) ?? author.name }] as const;
		}),
	);
	return new Map(resolved.filter((entry) => !!entry));
}

async function findMember(token: string, vanity: string): Promise<string | undefined> {
	const query = new URLSearchParams({
		q: "vanityUrlAsOrganization",
		vanityUrl: `https://www.linkedin.com/in/${vanity}`,
		organization: organization(),
	});
	const res = await fetch(`${API}/vanityUrl?${query}`, { headers: headers(token) });
	if (!res.ok) console.warn(`linkedin: no mention for ${vanity}: ${res.status} ${(await res.text()).slice(0, 200)}`);
	const data = res.ok ? ((await res.json()) as { elements?: { member?: string }[] }) : {};
	return data.elements?.[0]?.member;
}

// A mention only links when its text is the LinkedIn name, which can differ from the Ghost one.
async function linkedinName(token: string, urn: string, ghostName: string): Promise<string | undefined> {
	const words = ghostName
		.split(/\s+/)
		.map((w) => w.replace(/\P{L}/gu, ""))
		.filter(Boolean);
	const pairs = words.length > 1 ? [`${words[0]} ${words.at(-1)}`, `${words[0]} ${words[1]}`] : [];
	const keywords = [...new Set([...pairs, ...words])].filter((k) => k.length >= (k.includes(" ") ? 6 : 3));
	for (const keyword of keywords) {
		const query = new URLSearchParams({ q: "organizationFollowers", keywords: keyword, organization: organization() });
		const res = await fetch(`${API}/peopleTypeahead?${query}`, { headers: headers(token) });
		if (!res.ok) continue;
		const { elements = [] } = (await res.json()) as { elements?: { member: string; firstName?: string; lastName?: string }[] };
		const person = elements.find((e) => e.member === urn);
		if (person) return `${person.firstName ?? ""} ${person.lastName ?? ""}`.replace(/\s+/g, " ").trim() || undefined;
	}
}

export function commentary(post: GhostPost, people: Map<string, Person>, text = ""): string {
	const names = (post.authors ?? []).map((author) => {
		const vanity = linkedinVanity(author.linkedin);
		const person = vanity && people.get(vanity);
		return person ? `@[${escape(person.name)}](${person.urn})` : escape(author.name);
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
