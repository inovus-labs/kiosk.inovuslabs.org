// The ActivityPub service identifies the site by X-Forwarded-Host.
export function proxyActivityPub(request: Request, target: string): Promise<Response> {
	const url = new URL(request.url);
	const headers = new Headers(request.headers);
	headers.set("X-Forwarded-Host", url.host);
	headers.set("X-Forwarded-Proto", "https");

	// Breaks a redirect loop with browsers' cached Ghost trailing-slash 301s.
	const path = url.pathname.replace(/(.)\/+$/, "$1");

	return fetch(new URL(path + url.search, target), {
		method: request.method,
		headers,
		body: request.body,
		redirect: "manual",
	});
}
