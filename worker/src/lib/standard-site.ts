// Standard.site records that make blog.inovuslabs.org a publication on Bluesky: one publication record, and one
// document per post. No Worker imports, so the backfill script can use it too.
import type { GhostPost } from "./bluesky-post";

export const BLOG_URL = "https://blog.inovuslabs.org";
export const DID = "did:plc:2fftr5c2q5za7tbw5fmoowjt";
export const PUBLICATION = "site.standard.publication";
export const DOCUMENT = "site.standard.document";
export const PUBLICATION_KEY = "3my4ce3q222ri";

export interface StrongRef {
	uri: string;
	cid: string;
}

const S32 = "234567abcdefghijklmnopqrstuvwxyz";

// Both collections use TID record keys. Making one from the post's publish date (and its path for the clock bits)
// gives every post a fixed key, so blog pages can link to their record without asking the PDS.
export function tid(date: Date, seed = ""): string {
	const clock = [...seed].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 1024, 0);
	let value = ((BigInt(date.getTime()) * 1000n) << 10n) | BigInt(clock);
	let key = "";
	for (let i = 0; i < 13; i++) {
		key = S32[Number(value & 31n)] + key;
		value >>= 5n;
	}
	return key;
}

export const publicationUri = `at://${DID}/${PUBLICATION}/${PUBLICATION_KEY}`;
export const documentKey = (publishedAt: string, path: string) => tid(new Date(publishedAt), path);
export const documentUri = (publishedAt: string, path: string) => `at://${DID}/${DOCUMENT}/${documentKey(publishedAt, path)}`;
export const postPath = (post: GhostPost) => new URL(post.url).pathname;

const rgb = (hex: string) => {
	const [r, g, b] = (hex.slice(1).match(/../g) ?? []).map((pair) => parseInt(pair, 16));
	return { $type: "site.standard.theme.color#rgb", r, g, b };
};

/** `icon` is the blob ref of the Inovus logo, uploaded once. */
export function publicationRecord(icon: unknown) {
	return {
		$type: PUBLICATION,
		url: BLOG_URL,
		name: "Inovus Blogs",
		description:
			"Thoughts, codes, stories & ideas from a bunch of 21st-century human beings. A digital abode for all crazy tinkers & thinkers of our time.",
		icon,
		basicTheme: {
			$type: "site.standard.theme.basic",
			background: rgb("#ffffff"),
			foreground: rgb("#15212a"),
			accent: rgb("#4d90ff"),
			accentForeground: rgb("#ffffff"),
		},
	};
}
