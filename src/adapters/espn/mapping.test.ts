import { describe, expect, it } from "vitest";

import {
  competitionExternalId,
  mapStatus,
  parseCompetitionExternalId,
  roundFromSeasonSlug,
  seasonCalendarYears,
  seasonLabel,
} from "./mapping";

describe("mapStatus", () => {
  it.each([
    ["STATUS_SCHEDULED", "pre", "scheduled", false],
    ["STATUS_FULL_TIME", "post", "finished", false],
    ["STATUS_FINAL_AET", "post", "finished", true],
    ["STATUS_FINAL_PEN", "post", "finished", true],
    ["STATUS_ABANDONED", "post", "postponed", false],
  ] as const)("%s", (name, state, status, extraTime) => {
    expect(mapStatus(name, state, "test")).toEqual({ status, extraTime });
  });

  it("falls back to live for an unknown name in progress", () => {
    expect(mapStatus("STATUS_HALFTIME", "in", "test").status).toBe("live");
  });

  it("throws for an unknown name that is not in progress", () => {
    expect(() => mapStatus("STATUS_POSTPONED", "post", "ctx")).toThrow(
      'ctx: unknown match status "STATUS_POSTPONED"',
    );
  });
});

describe("seasons", () => {
  it("labels split and calendar seasons", () => {
    expect(seasonLabel(2026, "split")).toBe("2026-27");
    expect(seasonLabel(2099, "split")).toBe("2099-00");
    expect(seasonLabel(2026, "calendar")).toBe("2026");
  });

  it("lists the calendar years a season touches", () => {
    expect(seasonCalendarYears(2026, "split")).toEqual([2026, 2027]);
    expect(seasonCalendarYears(2026, "calendar")).toEqual([2026]);
  });
});

describe("competition IDs", () => {
  it("round-trips", () => {
    const id = competitionExternalId("eng.1", 2026);
    expect(id).toBe("eng.1:2026");
    expect(parseCompetitionExternalId(id)).toEqual({
      slug: "eng.1",
      year: 2026,
    });
  });

  it("rejects malformed IDs", () => {
    expect(parseCompetitionExternalId("eng.1")).toBeNull();
    expect(parseCompetitionExternalId("eng.1:26")).toBeNull();
  });
});

describe("roundFromSeasonSlug", () => {
  it.each([
    ["torneo-apertura", "Apertura"],
    ["torneo-clausura", "Clausura"],
    ["apertura---round-of-16", "Apertura - Round of 16"],
    ["apertura---quarterfinals", "Apertura - Quarterfinals"],
    ["apertura---final", "Apertura - Final"],
  ])("%s -> %s", (slug, expected) => {
    expect(roundFromSeasonSlug(slug, "calendar")).toBe(expected);
  });

  it("is null for split seasons", () => {
    expect(
      roundFromSeasonSlug("2026-27-english-premier-league", "split"),
    ).toBeNull();
  });
});
