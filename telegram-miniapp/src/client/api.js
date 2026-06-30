export async function apiGet(path, params = {}, platform) {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
  }
  const response = await fetch(url, { headers: platform?.headers?.() || {} });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function apiPost(path, body, platform, extraHeaders = {}) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(platform?.headers?.() || {}),
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

async function readError(response) {
  try {
    const data = await response.json();
    return data.error || response.statusText;
  } catch {
    return response.statusText;
  }
}
