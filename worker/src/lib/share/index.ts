import { env, waitUntil } from "cloudflare:workers";
import { bluesky } from "./bluesky";
import { linkedin } from "./linkedin";
import type { GhostPost, Platform } from "./platform";

// Each platform has its own draft type.
const PLATFORMS: Platform<any>[] = [bluesky, linkedin];

/** Shares a newly published Ghost post on every platform after the response; failures are only logged. */
export function sharePost(post: GhostPost) {
	for (const platform of PLATFORMS) {
		waitUntil(share(platform, post).catch((error) => console.error(`${platform.id}: post ${post.id} failed:`, error)));
	}
}

async function share<Draft extends object>(platform: Platform<Draft>, post: GhostPost) {
	const vars = env as unknown as Record<string, unknown>;
	const name = platform.id.toUpperCase();
	const store = vars[name] as KVNamespace;
	const key = `post:${post.id}`;
	const existing = await store.get(key);
	if (existing) return console.log(`${platform.id}: post ${post.id} already at ${existing}`);

	const draft = await platform.prepare(post);
	if (vars[`${name}_DRY_RUN`] === "true") {
		return console.log(`${platform.id}: dry run`, JSON.stringify({ post: post.id, ...draft }, byteCounts));
	}
	const address = await platform.publish(post, draft);
	await store.put(key, address);
	console.log(`${platform.id}: posted ${post.id} as ${address}`);
}

const byteCounts = (_key: string, value: unknown) => (value instanceof ArrayBuffer ? `${value.byteLength} bytes` : value);
