import { and, count, eq } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEspnAdapter } from "../adapters/espn/adapter";
import { fakeFetch } from "../adapters/espn/testing";
import type {
  NormalizedCompetition,
  NormalizedEvent,
  NormalizedParticipant,
  NormalizedStanding,
  SportAdapter,
} from "../adapters/types";
import {
  competition,
  event,
  eventParticipant,
  externalRef,
  participant,
  sport,
  standing,
} from "../db/schema";
import { seed } from "../db/seed";
import { createTestDb } from "../db/testing";
import { syncAdapter } from "./sync";

const NOW = new Date("2026-11-05T21:30:00Z");

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  ctx = await createTestDb();
});

afterEach(() => {
  ctx.client.close();
});

async function rows(table: SQLiteTable) {
  const [row] = await ctx.db.select({ n: count() }).from(table);
  return row.n;
}

/** Our internal ID for the entity the stub calls `externalId`. */
async function internalId(provider: string, externalId: string) {
  const [ref] = await ctx.db
    .select({ id: externalRef.entityId })
    .from(externalRef)
    .where(
      and(
        eq(externalRef.provider, provider),
        eq(externalRef.externalId, externalId),
      ),
    );
  return ref?.id;
}

// --- A hand-made adapter, so these tests do not depend on ESPN at all. ---

const team = (id: string, name: string): NormalizedParticipant => ({
  externalId: id,
  kind: "team",
  name,
  shortName: name.slice(0, 3).toUpperCase(),
  imageUrl: null,
});

const comp = (externalId: string): NormalizedCompetition => ({
  externalId,
  sportId: "football",
  name: `League ${externalId}`,
  season: "2026-27",
  country: "GB",
});

function match(
  externalId: string,
  competitionExternalId: string,
  overrides: Partial<NormalizedEvent> = {},
): NormalizedEvent {
  return {
    externalId,
    competitionExternalId,
    startsAt: new Date("2026-12-01T20:00:00Z"),
    timeConfirmed: true,
    status: "scheduled",
    round: null,
    venue: "Main Stadium",
    details: { extraTime: false },
    participants: [
      { participant: team("t1", "Alpha"), role: "home", outcome: null },
      { participant: team("t2", "Beta"), role: "away", outcome: null },
    ],
    ...overrides,
  };
}

function table(
  competitionExternalId: string,
  entries: [NormalizedParticipant, number][],
): NormalizedStanding[] {
  return entries.map(([p, rank]) => ({
    competitionExternalId,
    participant: p,
    table: "league",
    rank,
    points: 30 - rank,
    stats: { played: 10 },
  }));
}

type StubData = {
  competitions: NormalizedCompetition[];
  events: Record<string, NormalizedEvent[]>;
  standings: Record<string, NormalizedStanding[]>;
  failEventsFor?: string;
};

function stub(data: StubData): SportAdapter {
  return {
    provider: "stub",
    fetchCompetitions: async () => data.competitions,
    fetchEvents: async (id) => {
      if (id === data.failEventsFor)
        throw new Error(`events of ${id} are broken`);
      return data.events[id] ?? [];
    },
    fetchStandings: async (id) => data.standings[id] ?? [],
  };
}

function basicData(): StubData {
  const a = team("t1", "Alpha");
  const b = team("t2", "Beta");
  return {
    competitions: [comp("c1")],
    events: { c1: [match("e1", "c1"), match("e2", "c1")] },
    standings: {
      c1: table("c1", [
        [a, 1],
        [b, 2],
      ]),
    },
  };
}

describe("syncAdapter with a stub adapter", () => {
  it("creates the competition, teams, events, sides, standings and refs", async () => {
    const result = await syncAdapter(ctx.db, stub(basicData()), { now: NOW });

    expect(result.errors).toEqual([]);
    expect(result.competitions).toEqual({ created: 1, updated: 0 });
    expect(result.events).toEqual({ created: 2, updated: 0 });
    expect(result.standings).toBe(2);
    // Two teams, each seen in both events and in the table, saved once.
    expect(await rows(participant)).toBe(2);
    expect(await rows(event)).toBe(2);
    expect(await rows(eventParticipant)).toBe(4);
    // 1 competition + 2 teams + 2 events.
    expect(await rows(externalRef)).toBe(5);
    expect(await rows(sport)).toBe(1);
  });

  it("does not duplicate anything when run twice, and keeps our IDs", async () => {
    const adapter = stub(basicData());
    await syncAdapter(ctx.db, adapter, { now: NOW });
    const before = await ctx.db.select({ id: event.id }).from(event);

    const second = await syncAdapter(ctx.db, adapter, { now: NOW });

    expect(second.events).toEqual({ created: 0, updated: 2 });
    expect(second.competitions).toEqual({ created: 0, updated: 1 });
    expect(await rows(event)).toBe(2);
    expect(await rows(participant)).toBe(2);
    expect(await rows(standing)).toBe(2);
    expect(await rows(externalRef)).toBe(5);
    expect(await ctx.db.select({ id: event.id }).from(event)).toEqual(before);
  });

  it("updates the same event when its time changes, keeping our ID", async () => {
    const data = basicData();
    await syncAdapter(ctx.db, stub(data), { now: NOW });
    const idBefore = await internalId("stub", "e1");

    data.events.c1 = [
      match("e1", "c1", {
        startsAt: new Date("2026-12-02T18:30:00Z"),
        timeConfirmed: false,
        venue: "New Ground",
      }),
    ];
    await syncAdapter(ctx.db, stub(data), { now: NOW });

    expect(await internalId("stub", "e1")).toBe(idBefore);
    const [moved] = await ctx.db
      .select()
      .from(event)
      .where(eq(event.id, idBefore!));
    expect(moved.startsAt.toISOString()).toBe("2026-12-02T18:30:00.000Z");
    expect(moved.timeConfirmed).toBe(false);
    expect(moved.venue).toBe("New Ground");
    expect(await rows(event)).toBe(2);
  });

  it("records a result and rewrites the sides", async () => {
    const data = basicData();
    await syncAdapter(ctx.db, stub(data), { now: NOW });

    data.events.c1 = [
      match("e1", "c1", {
        status: "finished",
        participants: [
          {
            participant: team("t1", "Alpha"),
            role: "home",
            outcome: { score: 3 },
          },
          {
            participant: team("t2", "Beta"),
            role: "away",
            outcome: { score: 1 },
          },
        ],
      }),
    ];
    await syncAdapter(ctx.db, stub(data), { now: NOW });

    const [e1] = await ctx.db
      .select()
      .from(event)
      .where(eq(event.status, "finished"));
    const sides = await ctx.db
      .select()
      .from(eventParticipant)
      .where(eq(eventParticipant.eventId, e1.id));
    expect(sides).toHaveLength(2);
    expect(sides.map((s) => [s.role, s.outcome])).toEqual(
      expect.arrayContaining([
        ["home", { score: 3 }],
        ["away", { score: 1 }],
      ]),
    );
  });

  it("replaces standings, so a team that left the table disappears", async () => {
    const data = basicData();
    await syncAdapter(ctx.db, stub(data), { now: NOW });
    expect(await rows(standing)).toBe(2);

    const later = new Date("2026-11-06T09:00:00Z");
    data.standings.c1 = table("c1", [[team("t3", "Gamma"), 1]]);
    await syncAdapter(ctx.db, stub(data), { now: later });

    const stored = await ctx.db.select().from(standing);
    expect(stored).toHaveLength(1);
    expect(stored[0].updatedAt.toISOString()).toBe(later.toISOString());
    // A team that only appears in the table is still created.
    const [gamma] = await ctx.db
      .select()
      .from(participant)
      .where(eq(participant.name, "Gamma"));
    expect(stored[0].participantId).toBe(gamma.id);
  });

  it("never deletes an event the provider stops listing", async () => {
    const data = basicData();
    await syncAdapter(ctx.db, stub(data), { now: NOW });

    data.events.c1 = [match("e1", "c1")];
    await syncAdapter(ctx.db, stub(data), { now: NOW });

    expect(await rows(event)).toBe(2);
  });

  it("saves the other competitions when one fails", async () => {
    const data = basicData();
    data.competitions.push(comp("c2"));
    data.events.c2 = [match("e3", "c2")];
    data.failEventsFor = "c1";

    const result = await syncAdapter(ctx.db, stub(data), { now: NOW });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].competition).toBe("c1");
    expect(String(result.errors[0].error)).toContain("events of c1 are broken");
    const saved = await ctx.db.select().from(competition);
    expect(saved.map((c) => c.name)).toEqual(["League c2"]);
  });

  it("leaves nothing behind when saving a competition fails halfway", async () => {
    const data = basicData();
    const a = team("t1", "Alpha");
    // The same team twice in the same table breaks the primary key, after the
    // competition, teams and events were already written inside the transaction.
    data.standings.c1 = table("c1", [
      [a, 1],
      [a, 2],
    ]);

    const result = await syncAdapter(ctx.db, stub(data), { now: NOW });

    expect(result.errors).toHaveLength(1);
    expect(await rows(competition)).toBe(0);
    expect(await rows(event)).toBe(0);
    expect(await rows(participant)).toBe(0);
    expect(await rows(externalRef)).toBe(0);
  });

  it("does not touch data it does not own", async () => {
    await seed(ctx.db, NOW);

    await syncAdapter(ctx.db, stub(basicData()), { now: NOW });

    // The 8 sample matches are still there next to the 2 synced ones.
    expect(await rows(event)).toBe(10);
    expect(await rows(competition)).toBe(2);
  });

  it("reports progress through the log callback", async () => {
    const lines: string[] = [];
    await syncAdapter(ctx.db, stub(basicData()), {
      now: NOW,
      log: (m) => lines.push(m),
    });
    expect(lines).toEqual(["c1: 2 events (2 new), 2 standing rows"]);
  });

  it("refuses a sport it has no name for", async () => {
    const data = basicData();
    data.competitions = [{ ...comp("c1"), sportId: "curling" }];
    await expect(syncAdapter(ctx.db, stub(data))).rejects.toThrow(
      /unknown sport "curling"/,
    );
  });
});

describe("syncAdapter with the ESPN adapter and its fixtures", () => {
  const espn = () => createEspnAdapter({ fetch: fakeFetch().fetch });

  it("saves the four leagues", async () => {
    const result = await syncAdapter(ctx.db, espn(), { now: NOW });

    expect(result.errors).toEqual([]);
    expect(result.competitions.created).toBe(4);
    // 4 + 6 + 4 + 8 matches in the saved fixtures.
    expect(result.events.created).toBe(22);
    // 20 + 20 + 20 + 30 table rows.
    expect(result.standings).toBe(90);
    expect(await rows(standing)).toBe(90);

    const names = (await ctx.db.select().from(competition)).map((c) => [
      c.name,
      c.season,
    ]);
    expect(names).toEqual(
      expect.arrayContaining([
        ["Liga Profesional", "2026"],
        ["Premier League", "2026-27"],
      ]),
    );
  });

  it("keeps the unconfirmed time and the postponed status", async () => {
    await syncAdapter(ctx.db, espn(), { now: NOW });

    const unconfirmed = await ctx.db
      .select()
      .from(event)
      .where(eq(event.timeConfirmed, false));
    expect(unconfirmed.length).toBeGreaterThan(0);
    expect(
      await ctx.db.select().from(event).where(eq(event.status, "postponed")),
    ).toHaveLength(1);
  });

  it("is idempotent against the real responses", async () => {
    await syncAdapter(ctx.db, espn(), { now: NOW });
    const eventsBefore = await ctx.db.select({ id: event.id }).from(event);
    const teamsBefore = await rows(participant);
    const refsBefore = await rows(externalRef);

    const second = await syncAdapter(ctx.db, espn(), { now: NOW });

    expect(
      second.competitions.created +
        second.events.created +
        second.participants.created,
    ).toBe(0);
    expect(await ctx.db.select({ id: event.id }).from(event)).toEqual(
      eventsBefore,
    );
    expect(await rows(participant)).toBe(teamsBefore);
    expect(await rows(externalRef)).toBe(refsBefore);
  });

  it("reports a malformed response by league and keeps the rest", async () => {
    const broken = createEspnAdapter({
      fetch: fakeFetch((json, kind, slug) => {
        if (kind === "standings" && slug === "ita.1") delete json.children;
      }).fetch,
    });

    const result = await syncAdapter(ctx.db, broken, { now: NOW });

    expect(result.errors.map((e) => e.competition)).toEqual(["ita.1:2026"]);
    expect(String(result.errors[0].error)).toContain(
      'invalid field "children"',
    );
    expect(await rows(competition)).toBe(3);
  });
});
