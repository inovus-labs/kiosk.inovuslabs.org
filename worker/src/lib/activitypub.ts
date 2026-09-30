// The ActivityPub service identifies the site by X-Forwarded-Host.
export function proxyActivityPub(request: Request, target: string): Promise<Response> {
	const url = new URL(request.url);
	const headers = new Headers(request.headers);
	headers.set("X-Forwarded-Host", url.host);
	headers.set("X-Forwarded-Proto", "https");

	return fetch(new URL(url.pathname + url.search, target), {
		method: request.method,
		headers,
		body: request.body,
		redirect: "manual",
	});
}
