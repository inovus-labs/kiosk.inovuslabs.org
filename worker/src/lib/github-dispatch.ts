export type DispatchEnv = {
  GITHUB_REPO: string
  GH_TOKEN: string
}

export type DispatchClientPayload = Record<string, unknown> | undefined

export async function fireRepositoryDispatch(
  env: DispatchEnv,
  eventType: string,
  clientPayload?: DispatchClientPayload,
): Promise<Response> {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'kiosk-worker',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: eventType,
      client_payload: clientPayload ?? {},
    }),
  })
}
