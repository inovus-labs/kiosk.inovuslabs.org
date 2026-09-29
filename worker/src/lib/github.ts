import { env } from "cloudflare:workers";

/** Fire a `repository_dispatch` at the kiosk repo so GitHub Actions rebuilds the display. */
export async function dispatchBuild(
	eventType: string,
	clientPayload: Record<string, unknown> = {},
): Promise<Response> {
	return fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.GH_TOKEN}`,
			Accept: "application/vnd.github+json",
			"User-Agent": "kiosk-worker",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ event_type: eventType, client_payload: clientPayload }),
	});
}
