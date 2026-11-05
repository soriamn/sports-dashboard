import { count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  competition,
  event,
  eventParticipant,
  externalRef,
  participant,
  sport,
  standing,
} from "./schema";
import { seed } from "./seed";
import { createTestDb } from "./testing";

// Fixed "now" so the seed's relative dates are predictable.
const NOW = new Date("2026-11-04T10:30:00Z");

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  ctx = await createTestDb();
});

afterEach(() => {
  ctx.client.close();
});

async function countRows(table: typeof sport | typeof event) {
  const [row] = await ctx.db.select({ n: count() }).from(table);
  return row.n;
}

describe("migrations", () => {
  it("create the expected tables", async () => {
    const result = await ctx.client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '%drizzle%' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    expect(result.rows.map((r) => r.name)).toEqual([
      "competition",
      "event",
      "event_participant",
      "external_ref",
      "participant",
      "sport",
      "standing",
    ]);
  });

  it("enforce foreign keys", async () => {
    await expect(
      ctx.db
        .insert(competition)
        .values({ sportId: "missing", name: "Nope", season: "2026" }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringContaining("FOREIGN KEY") },
    });
  });

  it("delete an event's participants together with the event", async () => {
    await seed(ctx.db, NOW);
    await ctx.db.delete(event).where(eq(event.id, "match-01"));

    const remaining = await ctx.db
      .select()
      .from(eventParticipant)
      .where(eq(eventParticipant.eventId, "match-01"));
    expect(remaining).toEqual([]);
  });
});

describe("event columns", () => {
  it("apply defaults and round-trip UTC timestamps and JSON", async () => {
    await ctx.db.insert(sport).values({ id: "football", name: "Football" });
    await ctx.db
      .insert(competition)
      .values({ id: "c1", sportId: "football", name: "Cup", season: "2026" });

    const startsAt = new Date("2026-12-01T19:45:00Z");
    await ctx.db
      .insert(event)
      .values({ id: "e1", competitionId: "c1", startsAt });

    const [row] = await ctx.db.select().from(event).where(eq(event.id, "e1"));
    expect(row.startsAt.toISOString()).toBe("2026-12-01T19:45:00.000Z");
    expect(row.timeConfirmed).toBe(true);
    expect(row.status).toBe("scheduled");
    expect(row.details).toEqual({});
  });
});

describe("external_ref", () => {
  it("maps one provider ID to a single entity", async () => {
    await ctx.db.insert(externalRef).values({
      entityType: "event",
      entityId: "match-01",
      provider: "espn",
      externalId: "740780",
    });

    // The same provider ID cannot point at a second entity.
    await expect(
      ctx.db.insert(externalRef).values({
        entityType: "event",
        entityId: "match-02",
        provider: "espn",
        externalId: "740780",
      }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringContaining("UNIQUE") },
    });

    // The same ID is fine for another provider or another entity type.
    await ctx.db.insert(externalRef).values([
      {
        entityType: "event",
        entityId: "x",
        provider: "other",
        externalId: "740780",
      },
      {
        entityType: "participant",
        entityId: "y",
        provider: "espn",
        externalId: "740780",
      },
    ]);
    expect(await ctx.db.select().from(externalRef)).toHaveLength(3);
  });
});

describe("standing", () => {
  async function insertCompetitionAndTeams() {
    await ctx.db.insert(sport).values({ id: "football", name: "Football" });
    await ctx.db.insert(competition).values({
      id: "c1",
      sportId: "football",
      name: "League",
      season: "2026",
    });
    await ctx.db.insert(participant).values([
      { id: "t1", sportId: "football", kind: "team", name: "One" },
      { id: "t2", sportId: "football", kind: "team", name: "Two" },
    ]);
  }

  it("round-trips points, JSON stats and the UTC timestamp", async () => {
    await insertCompetitionAndTeams();
    const updatedAt = new Date("2026-11-05T21:30:00Z");
    await ctx.db.insert(standing).values({
      competitionId: "c1",
      participantId: "t1",
      tableName: "league",
      rank: 1,
      points: 24.5,
      stats: { played: 9, won: 8 },
      updatedAt,
    });

    const [row] = await ctx.db.select().from(standing);
    expect(row.points).toBe(24.5);
    expect(row.stats).toEqual({ played: 9, won: 8 });
    expect(row.updatedAt.toISOString()).toBe("2026-11-05T21:30:00.000Z");
  });

  it("allows one row per participant in each table of a competition", async () => {
    await insertCompetitionAndTeams();
    const row = {
      competitionId: "c1",
      participantId: "t1",
      rank: 1,
      points: 3,
      updatedAt: new Date(),
    };
    await ctx.db.insert(standing).values({ ...row, tableName: "Group A" });
    await ctx.db.insert(standing).values({ ...row, tableName: "Group B" });

    await expect(
      ctx.db.insert(standing).values({ ...row, tableName: "Group A" }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringContaining("UNIQUE") },
    });
  });

  it("enforces foreign keys", async () => {
    await expect(
      ctx.db.insert(standing).values({
        competitionId: "missing",
        participantId: "missing",
        tableName: "league",
        rank: 1,
        points: 0,
        updatedAt: new Date(),
      }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringContaining("FOREIGN KEY") },
    });
  });
});

describe("seed", () => {
  it("loads the sample data", async () => {
    const counts = await seed(ctx.db, NOW);

    expect(counts).toEqual({ teams: 6, events: 8 });
    expect(await countRows(sport)).toBe(1);
    expect(await countRows(event)).toBe(8);

    const participants = await ctx.db.select().from(participant);
    expect(participants).toHaveLength(6);
    expect(participants.every((p) => p.kind === "team")).toBe(true);

    const links = await ctx.db.select().from(eventParticipant);
    expect(links).toHaveLength(16);
  });

  it("also clears external refs and standings left by a sync", async () => {
    await seed(ctx.db, NOW);
    await ctx.db.insert(externalRef).values({
      entityType: "event",
      entityId: "match-01",
      provider: "espn",
      externalId: "1",
    });
    await ctx.db.insert(standing).values({
      competitionId: "sample-league-2026-27",
      participantId: "riverside-fc",
      tableName: "league",
      rank: 1,
      points: 3,
      updatedAt: NOW,
    });

    await seed(ctx.db, NOW);

    expect(await ctx.db.select().from(externalRef)).toEqual([]);
    expect(await ctx.db.select().from(standing)).toEqual([]);
  });

  it("can run twice without duplicating rows", async () => {
    await seed(ctx.db, NOW);
    await seed(ctx.db, NOW);

    expect(await countRows(event)).toBe(8);
  });

  it("creates finished matches in the past and the rest in the future", async () => {
    await seed(ctx.db, NOW);
    const events = await ctx.db.select().from(event);

    for (const e of events) {
      if (e.status === "finished") {
        expect(e.startsAt.getTime()).toBeLessThan(NOW.getTime());
      } else {
        expect(e.startsAt.getTime()).toBeGreaterThan(NOW.getTime());
      }
    }
  });

  it("includes an unconfirmed time, a postponed match and results", async () => {
    await seed(ctx.db, NOW);

    const unconfirmed = await ctx.db
      .select()
      .from(event)
      .where(eq(event.timeConfirmed, false));
    expect(unconfirmed.map((e) => e.id).sort()).toEqual([
      "match-07",
      "match-08",
    ]);

    const postponed = await ctx.db
      .select()
      .from(event)
      .where(eq(event.status, "postponed"));
    expect(postponed).toHaveLength(1);

    // match-01 finished 2-1 for the home side.
    const sides = await ctx.db
      .select()
      .from(eventParticipant)
      .where(eq(eventParticipant.eventId, "match-01"));
    const away = sides.find((s) => s.role === "away");
    expect(away?.participantId).toBe("harbor-united");
    expect(away?.outcome).toEqual({ score: 1 });
  });
});
