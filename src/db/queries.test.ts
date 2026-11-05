import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getTeam, getTeamEvents } from "./queries";
import { participant } from "./schema";
import { seed } from "./seed";
import { createTestDb } from "./testing";

// Same fixed "now" as the seed tests: the seed's dates are relative to it.
const NOW = new Date("2026-11-04T10:30:00Z");

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  ctx = await createTestDb();
  await seed(ctx.db, NOW);
});

afterEach(() => {
  ctx.client.close();
});

describe("getTeam", () => {
  it("finds a team", async () => {
    expect(await getTeam(ctx.db, "riverside-fc")).toEqual({
      id: "riverside-fc",
      sportId: "football",
      name: "Riverside FC",
    });
  });

  it("returns null for an unknown id", async () => {
    expect(await getTeam(ctx.db, "nobody")).toBeNull();
  });

  it("returns null for a participant that is not a team", async () => {
    await ctx.db.insert(participant).values({
      id: "some-driver",
      sportId: "football",
      kind: "athlete",
      name: "Some Driver",
    });
    expect(await getTeam(ctx.db, "some-driver")).toBeNull();
  });
});

describe("getTeamEvents", () => {
  it("returns only the team's upcoming events, soonest first", async () => {
    const events = await getTeamEvents(ctx.db, "riverside-fc", NOW);

    expect(events.map((e) => e.id)).toEqual([
      "match-04",
      "match-06",
      "match-07",
    ]);
  });

  it("includes both sides of each match, home first", async () => {
    const events = await getTeamEvents(ctx.db, "riverside-fc", NOW);

    expect(events[0].participants.map((p) => p.name)).toEqual([
      "Riverside FC",
      "Mountain Athletic",
    ]);
    // match-06 is played away.
    expect(events[1].participants.map((p) => [p.name, p.role])).toEqual([
      ["Northgate Town", "home"],
      ["Riverside FC", "away"],
    ]);
  });

  it("carries the event details and the competition name", async () => {
    const [first] = await getTeamEvents(ctx.db, "riverside-fc", NOW);

    expect(first).toMatchObject({
      id: "match-04",
      startsAt: new Date("2026-11-07T19:00:00Z"),
      timeConfirmed: true,
      status: "scheduled",
      round: "Matchday 3",
      venue: "Riverside Park",
      competitionName: "Sample League",
    });
  });

  it("includes events that start exactly at `from`, and excludes earlier ones", async () => {
    const start = new Date("2026-11-07T19:00:00Z");

    const at = await getTeamEvents(ctx.db, "riverside-fc", start);
    expect(at[0].id).toBe("match-04");

    const after = await getTeamEvents(
      ctx.db,
      "riverside-fc",
      new Date(start.getTime() + 1),
    );
    expect(after[0].id).toBe("match-06");
  });

  it("returns an empty list when nothing is upcoming", async () => {
    const events = await getTeamEvents(
      ctx.db,
      "riverside-fc",
      new Date("2030-01-01T00:00:00Z"),
    );
    expect(events).toEqual([]);
  });
});
