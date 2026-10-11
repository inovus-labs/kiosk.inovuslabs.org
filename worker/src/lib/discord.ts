export class RateLimited extends Error {}
export class Rejected extends Error {}

export async function sendEmbed(webhookUrl: string, embed: Record<string, unknown>): Promise<void> {
	const target = new URL(webhookUrl);
	target.searchParams.set("wait", "true");
	const res = await fetch(target.href, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
	});
	if (res.ok) return;
	if (res.status === 429) throw new RateLimited();
	const detail = await res.text().catch(() => "");
	const message = `Discord webhook returned ${res.status}: ${detail.slice(0, 200)}`;
	throw res.status === 400 || res.status === 413 ? new Rejected(message) : new Error(message);
}
