import { readFileSync } from "node:fs";

// Test helpers: serve the real responses saved in __fixtures__ instead of calling
// ESPN. The scoreboard fixtures are `dates=2026` responses, so they are served for
// 2026 and an empty list is served for any other year.

export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function fixture(name: string): Json {
  return JSON.parse(
    readFileSync(
      new URL(`./__fixtures__/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}

/** Lets a test change a response before it is served, e.g. to break a field. */
export type Mutate = (
  json: Json,
  kind: "scoreboard" | "standings",
  slug: string,
) => void;

export function fakeFetch(mutate?: Mutate, status = 200) {
  const urls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (status !== 200) return new Response("nope", { status });

    const { pathname, searchParams } = new URL(url);
    const slug = /soccer\/([a-z]+\.\d+)\//.exec(pathname)![1];
    const kind = pathname.endsWith("/standings") ? "standings" : "scoreboard";
    const json = fixture(`${kind}-${slug}`);
    const dates = searchParams.get("dates");
    if (kind === "scoreboard" && dates !== null && dates !== "2026") {
      json.events = [];
    }
    mutate?.(json, kind, slug);
    return new Response(JSON.stringify(json));
  }) as typeof fetch;
  return { fetch: fetchFn, urls };
}
