function baseUrl(): string {
  return (process.env.MASSIVE_API_BASE_URL?.trim() || "https://api.massive.com").replace(/\/+$/, "");
}

export function massiveAuthHeaders(): Record<string, string> {
  const key = process.env.MASSIVE_API_KEY?.trim();
  if (!key) return {};
  // Massive docs support Authorization: Bearer YOUR_API_KEY (recommended).
  return { Authorization: `Bearer ${key}` };
}

export async function massiveGetJson<T>(opts: {
  path: string; // e.g. "/benzinga/v1/earnings"
  query?: Record<string, string | number | boolean | undefined>;
}): Promise<T> {
  const url = new URL(baseUrl() + opts.path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v === undefined) continue;
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...massiveAuthHeaders(),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Massive GET ${url.pathname} failed (${res.status}): ${text || res.statusText}`);
  }

  return (await res.json()) as T;
}


