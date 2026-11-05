import ICAL from "ical.js";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { event, participant } from "@/db/schema";
import { seed } from "@/db/seed";
import { createTestDb } from "@/db/testing";

import { handleTeamCalendarRequest } from "./handler";

const NOW = new Date("2026-11-04T10:30:00Z");

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  ctx = await createTestDb();
  await seed(ctx.db, NOW);
});

afterEach(() => {
  ctx.client.close();
});

async function fetchEvents(teamId: string, now: Date = NOW) {
  const response = await handleTeamCalendarRequest(ctx.db, teamId, now);
  const root = new ICAL.Component(ICAL.parse(await response.text()));
  return root.getAllSubcomponents("vevent");
}

describe("handleTeamCalendarRequest", () => {
  it("returns the team's calendar with calendar headers", async () => {
    const response = await handleTeamCalendarRequest(
      ctx.db,
      "riverside-fc",
      NOW,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/calendar; charset=utf-8",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'inline; filename="riverside-fc.ics"',
    );
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(await response.text()).toContain("BEGIN:VCALENDAR");
  });

  it("includes only upcoming matches of that team", async () => {
    const events = await fetchEvents("riverside-fc");

    expect(events.map((e) => e.getFirstPropertyValue("uid"))).toEqual([
      "match-04@sports-dashboard",
      "match-06@sports-dashboard",
      "match-07@sports-dashboard",
    ]);
  });

  it("marks the match with an unconfirmed time as tentative", async () => {
    const events = await fetchEvents("riverside-fc");
    const tbc = events.find(
      (e) => e.getFirstPropertyValue("uid") === "match-07@sports-dashboard",
    );

    expect(tbc?.getFirstPropertyValue("status")).toBe("TENTATIVE");
    expect(tbc?.getFirstPropertyValue("summary")).toBe(
      "Riverside FC vs Valley Rovers (time TBC)",
    );
  });

  it("shows a postponed match as tentative", async () => {
    const events = await fetchEvents("mountain-athletic");
    const postponed = events.find(
      (e) => e.getFirstPropertyValue("uid") === "match-08@sports-dashboard",
    );

    expect(postponed?.getFirstPropertyValue("summary")).toBe(
      "[Postponed] Mountain Athletic vs Valley Rovers (time TBC)",
    );
    expect(postponed?.getFirstPropertyValue("status")).toBe("TENTATIVE");
  });

  it("sends a cancelled match as cancelled so calendars can remove it", async () => {
    await ctx.db
      .update(event)
      .set({ status: "cancelled" })
      .where(eq(event.id, "match-04"));

    const events = await fetchEvents("riverside-fc");
    expect(events[0].getFirstPropertyValue("status")).toBe("CANCELLED");
  });

  it("keeps a match in the feed until its slot is over", async () => {
    // match-04 starts 2026-11-07 19:00 UTC and lasts two hours.
    const during = await fetchEvents(
      "riverside-fc",
      new Date("2026-11-07T20:59:00Z"),
    );
    expect(during.map((e) => e.getFirstPropertyValue("uid"))).toContain(
      "match-04@sports-dashboard",
    );

    const after = await fetchEvents(
      "riverside-fc",
      new Date("2026-11-07T21:01:00Z"),
    );
    expect(after.map((e) => e.getFirstPropertyValue("uid"))).not.toContain(
      "match-04@sports-dashboard",
    );
  });

  it("returns 404 for an unknown team", async () => {
    const response = await handleTeamCalendarRequest(ctx.db, "nobody", NOW);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Team not found");
  });

  it("returns 404 for a participant that is not a team", async () => {
    await ctx.db.insert(participant).values({
      id: "some-driver",
      sportId: "football",
      kind: "athlete",
      name: "Some Driver",
    });

    const response = await handleTeamCalendarRequest(
      ctx.db,
      "some-driver",
      NOW,
    );
    expect(response.status).toBe(404);
  });

  it("returns a valid empty calendar when nothing is upcoming", async () => {
    const events = await fetchEvents(
      "riverside-fc",
      new Date("2030-01-01T00:00:00Z"),
    );
    expect(events).toEqual([]);
  });
});
