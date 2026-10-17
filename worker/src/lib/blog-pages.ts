import { documentUri, publicationUri } from "./standard-site";

export const PUBLICATION_WELL_KNOWN = "/.well-known/site.standard.publication";

// Standard.site verification: every page links to the publication, and post pages to their own document. Bluesky's
// crawler reads these from the HTML, so they're added here rather than by script on the page.
export async function linkToPublication(request: Request): Promise<Response> {
	const response = await fetch(request);
	const isPage = request.method === "GET" && response.status === 200;
	if (!isPage || !response.headers.get("Content-Type")?.includes("text/html")) return response;

	const path = new URL(request.url).pathname;
	let publishedAt: string | null = null;
	return new HTMLRewriter()
		.on('meta[property="article:published_time"]', {
			element(meta) {
				publishedAt = meta.getAttribute("content");
			},
		})
		.on("head", {
			element(head) {
				head.onEndTag((end) => {
					let links = `<link rel="site.standard.publication" href="${publicationUri}">`;
					if (publishedAt) links += `<link rel="site.standard.document" href="${documentUri(publishedAt, path)}">`;
					end.before(links, { html: true });
				});
			},
		})
		.transform(response);
}
