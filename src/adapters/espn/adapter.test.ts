import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { AdapterError } from "../errors";
import { createEspnAdapter } from "./adapter";

// Tests run against the real responses saved in __fixtures__, never the network.
// The scoreboard fixtures are `dates=2026` responses, so they are served for 2026
// and an empty list is served for any other year.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function fixture(name: string): Json {
  return JSON.parse(
    readFileSync(
      new URL(`./__fixtures__/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}

type Mutate = (
  json: Json,
  kind: "scoreboard" | "standings",
  slug: string,
) => void;

function fakeFetch(mutate?: Mutate, status = 200) {
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

function adapter(mutate?: Mutate) {
  const fake = fakeFetch(mutate);
  return { adapter: createEspnAdapter({ fetch: fake.fetch }), urls: fake.urls };
}

describe("fetchCompetitions", () => {
  it("returns the four leagues with their current season", async () => {
    const { adapter: espn } = adapter();
    const competitions = await espn.fetchCompetitions();

    expect(
      competitions.map((c) => [c.externalId, c.name, c.season, c.country]),
    ).toEqual([
      ["arg.1:2026", "Liga Profesional", "2026", "AR"],
      ["eng.1:2026", "Premier League", "2026-27", "GB"],
      ["esp.1:2026", "La Liga", "2026-27", "ES"],
      ["ita.1:2026", "Serie A", "2026-27", "IT"],
    ]);
    expect(competitions.every((c) => c.sportId === "football")).toBe(true);
  });
});

describe("fetchEvents", () => {
  it("normalizes a scheduled match", async () => {
    const { adapter: espn } = adapter();
    const events = await espn.fetchEvents("eng.1:2026");
    expect(events).toHaveLength(4);

    // Everton also appears in a finished match, so pick the upcoming one.
    const everton = events.find(
      (e) =>
        e.status === "scheduled" &&
        e.participants.some((p) => p.participant.name === "Everton"),
    )!;
    expect(everton.startsAt.toISOString()).toBe("2026-11-06T20:00:00.000Z");
    expect(everton.status).toBe("scheduled");
    expect(everton.timeConfirmed).toBe(true);
    expect(everton.venue).toBe("Hill Dickinson Stadium");
    expect(everton.round).toBeNull();
    expect(everton.competitionExternalId).toBe("eng.1:2026");
    expect(everton.details).toEqual({ extraTime: false });

    const home = everton.participants.find((p) => p.role === "home")!;
    expect(home.participant).toMatchObject({
      kind: "team",
      name: "Everton",
      shortName: expect.any(String),
      imageUrl: expect.stringContaining("espncdn.com"),
    });
    // Nothing to report before kickoff, even though ESPN sends "0".
    expect(everton.participants.every((p) => p.outcome === null)).toBe(true);
  });

  it("converts text scores of finished matches to numbers", async () => {
    const { adapter: espn } = adapter();
    const events = await espn.fetchEvents("eng.1:2026");
    const finished = events.filter((e) => e.status === "finished");

    expect(finished).toHaveLength(2);
    for (const e of finished) {
      for (const p of e.participants) {
        expect(p.outcome).toEqual({ score: expect.any(Number) });
      }
    }
  });

  it("returns events ordered by start time", async () => {
    const { adapter: espn } = adapter();
    const events = await espn.fetchEvents("esp.1:2026");
    const times = events.map((e) => e.startsAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("marks matches with an unconfirmed time", async () => {
    const { adapter: espn } = adapter();
    const events = await espn.fetchEvents("esp.1:2026");

    const villarreal = events.find((e) =>
      e.participants.some((p) => p.participant.name === "Villarreal"),
    )!;
    expect(villarreal.timeConfirmed).toBe(false);
    expect(villarreal.status).toBe("scheduled");
  });

  it("treats an abandoned match as postponed, without a score", async () => {
    const { adapter: espn } = adapter();
    const events = await espn.fetchEvents("esp.1:2026");

    const abandoned = events.find((e) =>
      e.participants.some((p) => p.participant.name === "Rayo Vallecano"),
    )!;
    expect(abandoned.status).toBe("postponed");
    expect(abandoned.participants.every((p) => p.outcome === null)).toBe(true);
  });

  it("records extra time and the penalty shootout", async () => {
    const { adapter: espn } = adapter();
    const events = await espn.fetchEvents("arg.1:2026");

    const aet = events.find((e) =>
      e.participants.some((p) => p.participant.name === "Huracán"),
    )!;
    expect(aet.status).toBe("finished");
    expect(aet.details).toEqual({ extraTime: true });
    const scores = aet.participants.map((p) => [p.participant.name, p.outcome]);
    expect(scores).toContainEqual(["Huracán", { score: 3 }]);
    expect(scores).toContainEqual(["Boca Juniors", { score: 2 }]);

    const pens = events.find((e) =>
      e.participants.some((p) => p.participant.name === "San Lorenzo"),
    )!;
    expect(pens.details).toEqual({ extraTime: true });
    const river = pens.participants.find(
      (p) => p.participant.name === "River Plate",
    )!;
    const sanLorenzo = pens.participants.find(
      (p) => p.participant.name === "San Lorenzo",
    )!;
    expect(river.outcome).toEqual({ score: 2, shootoutScore: 4 });
    expect(sanLorenzo.outcome).toEqual({ score: 2, shootoutScore: 3 });
  });

  it("puts the Argentine tournament and playoff stage in the round", async () => {
    const { adapter: espn } = adapter();
    const events = await espn.fetchEvents("arg.1:2026");
    const rounds = new Set(events.map((e) => e.round));

    expect(rounds).toContain("Clausura");
    expect(rounds).toContain("Apertura - Final");
    expect(events.every((e) => e.competitionExternalId === "arg.1:2026")).toBe(
      true,
    );
  });

  it("asks for each calendar year a split season touches", async () => {
    const eng = adapter();
    await eng.adapter.fetchEvents("eng.1:2026");
    expect(eng.urls).toEqual([
      "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=2026&limit=500",
      "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=2027&limit=500",
    ]);

    const arg = adapter();
    await arg.adapter.fetchEvents("arg.1:2026");
    expect(arg.urls).toHaveLength(1);
  });

  it("keeps only the events of the requested season", async () => {
    const { adapter: espn } = adapter((json, kind) => {
      if (kind === "scoreboard" && json.events.length > 0) {
        json.events[0].season.year = 2025;
      }
    });
    const events = await espn.fetchEvents("eng.1:2026");
    expect(events).toHaveLength(3);
  });

  it("rejects a competition it does not know", async () => {
    const { adapter: espn } = adapter();
    await expect(espn.fetchEvents("xyz.1:2026")).rejects.toThrow(
      /unknown competition/,
    );
    await expect(espn.fetchEvents("garbage")).rejects.toThrow(AdapterError);
  });
});

describe("fetchEvents with bad provider data", () => {
  it("names the missing field", async () => {
    const { adapter: espn } = adapter((json, kind) => {
      if (kind === "scoreboard" && json.events.length > 1) {
        delete json.events[1].competitions[0].competitors[1].score;
      }
    });

    await expect(espn.fetchEvents("eng.1:2026")).rejects.toThrow(
      'invalid field "events[1].competitions[0].competitors[1].score"',
    );
  });

  it("names a field that is not a whole number", async () => {
    const { adapter: espn } = adapter((json, kind) => {
      if (kind === "scoreboard" && json.events.length > 0) {
        json.events[0].competitions[0].competitors[0].score = "two";
      }
    });

    await expect(espn.fetchEvents("eng.1:2026")).rejects.toThrow(
      /invalid field "events\[0\]\.competitions\[0\]\.competitors\[0\]\.score".*whole number/,
    );
  });

  it("fails on an unknown status instead of guessing", async () => {
    const { adapter: espn } = adapter((json, kind) => {
      if (kind === "scoreboard" && json.events.length > 0) {
        json.events[0].status.type.name = "STATUS_SOMETHING_NEW";
        json.events[0].status.type.state = "post";
      }
    });

    await expect(espn.fetchEvents("eng.1:2026")).rejects.toThrow(
      'unknown match status "STATUS_SOMETHING_NEW"',
    );
  });

  it("maps any status name to live while the match is in progress", async () => {
    const { adapter: espn } = adapter((json, kind) => {
      if (kind === "scoreboard" && json.events.length > 0) {
        json.events[0].status.type.name = "STATUS_SOMETHING_NEW";
        json.events[0].status.type.state = "in";
      }
    });

    const events = await espn.fetchEvents("eng.1:2026");
    expect(events.filter((e) => e.status === "live")).toHaveLength(1);
  });

  it("reports an HTTP error with its status and URL", async () => {
    const fake = fakeFetch(undefined, 503);
    const espn = createEspnAdapter({ fetch: fake.fetch });

    await expect(espn.fetchEvents("eng.1:2026")).rejects.toThrow(
      /HTTP 503 for https:\/\/site\.api\.espn\.com\/.*eng\.1\/scoreboard/,
    );
  });

  it("reports a network failure", async () => {
    const espn = createEspnAdapter({
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });

    await expect(espn.fetchEvents("eng.1:2026")).rejects.toThrow(
      /request to .* failed/,
    );
  });
});

describe("fetchStandings", () => {
  it("returns one league table with football stats", async () => {
    const { adapter: espn } = adapter();
    const rows = await espn.fetchStandings("eng.1:2026");

    expect(rows).toHaveLength(20);
    expect(rows.every((r) => r.table === "league")).toBe(true);
    expect(rows.every((r) => r.competitionExternalId === "eng.1:2026")).toBe(
      true,
    );

    const first = rows.find((r) => r.rank === 1)!;
    expect(first.participant.name).toBe("Arsenal");
    expect(first.participant.externalId).toBe("359");
    expect(first.participant.imageUrl).toContain("359.png");
    expect(first.points).toBe(24);
    expect(first.stats).toEqual({
      played: 9,
      won: 8,
      drawn: 0,
      lost: 1,
      goalsFor: 14,
      goalsAgainst: 5,
    });
  });

  it("keeps the Argentine groups as separate tables", async () => {
    const { adapter: espn } = adapter();
    const rows = await espn.fetchStandings("arg.1:2026");

    expect(rows.filter((r) => r.table === "Group A")).toHaveLength(15);
    expect(rows.filter((r) => r.table === "Group B")).toHaveLength(15);
    // Ranks restart in each group.
    expect(
      rows.filter((r) => r.table === "Group B" && r.rank === 1),
    ).toHaveLength(1);
  });

  it("refuses to attach a table to a season it is not for", async () => {
    const { adapter: espn } = adapter();
    await expect(espn.fetchStandings("eng.1:2025")).rejects.toThrow(
      /returned season 2026, but eng\.1:2025 was requested/,
    );
  });

  it("names a missing stat", async () => {
    const { adapter: espn } = adapter((json, kind) => {
      if (kind === "standings") {
        json.children[0].standings.entries[0].stats =
          json.children[0].standings.entries[0].stats.filter(
            (s: { name: string }) => s.name !== "points",
          );
      }
    });

    await expect(espn.fetchStandings("eng.1:2026")).rejects.toThrow(
      /children\[0\]\.standings\.entries\[0\]\.stats: invalid field "points"/,
    );
  });
});
