import ICAL from "ical.js";
import { describe, expect, it } from "vitest";

import type { Team, TeamEvent } from "@/db/queries";

import { buildTeamCalendar, eventSummary } from "./team-calendar";

const NOW = new Date("2026-11-04T10:30:00Z");
const TEAM: Team = {
  id: "riverside-fc",
  sportId: "football",
  name: "Riverside FC",
};

function makeEvent(overrides: Partial<TeamEvent> = {}): TeamEvent {
  return {
    id: "match-04",
    startsAt: new Date("2026-11-07T19:00:00Z"),
    timeConfirmed: true,
    status: "scheduled",
    round: "Matchday 3",
    venue: "Riverside Park",
    competitionName: "Sample League",
    participants: [
      { id: "riverside-fc", name: "Riverside FC", role: "home" },
      { id: "mountain-athletic", name: "Mountain Athletic", role: "away" },
    ],
    ...overrides,
  };
}

function parse(ics: string) {
  const root = new ICAL.Component(ICAL.parse(ics));
  return { root, events: root.getAllSubcomponents("vevent") };
}

describe("eventSummary", () => {
  it("shows home vs away", () => {
    expect(eventSummary(makeEvent())).toBe("Riverside FC vs Mountain Athletic");
  });

  it("marks unconfirmed times, postponed and cancelled events", () => {
    expect(eventSummary(makeEvent({ timeConfirmed: false }))).toBe(
      "Riverside FC vs Mountain Athletic (time TBC)",
    );
    expect(eventSummary(makeEvent({ status: "postponed" }))).toBe(
      "[Postponed] Riverside FC vs Mountain Athletic",
    );
    expect(eventSummary(makeEvent({ status: "cancelled" }))).toBe(
      "[Cancelled] Riverside FC vs Mountain Athletic",
    );
  });

  it("lists competitors separated by commas", () => {
    const race = makeEvent({
      participants: [
        { id: "a", name: "Driver A", role: "competitor" },
        { id: "b", name: "Driver B", role: "competitor" },
      ],
    });
    expect(eventSummary(race)).toBe("Driver A, Driver B");
  });
});

describe("buildTeamCalendar", () => {
  it("builds a calendar with one event per match", () => {
    const { root, events } = parse(buildTeamCalendar(TEAM, [makeEvent()], NOW));

    expect(root.getFirstPropertyValue("version")).toBe("2.0");
    expect(root.getFirstPropertyValue("x-wr-calname")).toBe(
      "Riverside FC fixtures",
    );
    expect(events).toHaveLength(1);
  });

  it("describes each event", () => {
    const { events } = parse(buildTeamCalendar(TEAM, [makeEvent()], NOW));
    const e = events[0];

    expect(e.getFirstPropertyValue("uid")).toBe("match-04@sports-dashboard");
    expect(e.getFirstPropertyValue("summary")).toBe(
      "Riverside FC vs Mountain Athletic",
    );
    expect(e.getFirstPropertyValue("location")).toBe("Riverside Park");
    expect(e.getFirstPropertyValue("description")).toBe(
      "Sample League · Matchday 3",
    );
    expect(e.getFirstPropertyValue("status")).toBe("CONFIRMED");
  });

  it("writes start and end in UTC, two hours apart for football", () => {
    const { events } = parse(buildTeamCalendar(TEAM, [makeEvent()], NOW));
    const e = events[0];

    const start = e.getFirstPropertyValue("dtstart") as ICAL.Time;
    const end = e.getFirstPropertyValue("dtend") as ICAL.Time;
    expect(start.toJSDate().toISOString()).toBe("2026-11-07T19:00:00.000Z");
    expect(end.toJSDate().toISOString()).toBe("2026-11-07T21:00:00.000Z");
    expect(start.zone.tzid).toBe("UTC");
  });

  it("marks unconfirmed and postponed events as tentative", () => {
    const events = [
      makeEvent({ id: "tbc", timeConfirmed: false }),
      makeEvent({ id: "late", status: "postponed" }),
    ];
    const parsed = parse(buildTeamCalendar(TEAM, events, NOW)).events;

    expect(parsed.map((e) => e.getFirstPropertyValue("status"))).toEqual([
      "TENTATIVE",
      "TENTATIVE",
    ]);
    expect(parsed[0].getFirstPropertyValue("description")).toContain(
      "still to be confirmed",
    );
  });

  it("marks cancelled events as cancelled", () => {
    const { events } = parse(
      buildTeamCalendar(TEAM, [makeEvent({ status: "cancelled" })], NOW),
    );
    expect(events[0].getFirstPropertyValue("status")).toBe("CANCELLED");
  });

  it("omits the location when there is no venue", () => {
    const { events } = parse(
      buildTeamCalendar(TEAM, [makeEvent({ venue: null })], NOW),
    );
    expect(events[0].hasProperty("location")).toBe(false);
  });

  it("escapes special characters in names", () => {
    const tricky = makeEvent({
      participants: [
        { id: "a", name: "Club, A; B", role: "home" },
        { id: "b", name: "Back\\slash", role: "away" },
      ],
    });
    const { events } = parse(buildTeamCalendar(TEAM, [tricky], NOW));

    expect(events[0].getFirstPropertyValue("summary")).toBe(
      "Club, A; B vs Back\\slash",
    );
  });

  it("builds a valid empty calendar", () => {
    const { events } = parse(buildTeamCalendar(TEAM, [], NOW));
    expect(events).toHaveLength(0);
  });

  it("is deterministic for the same input and time", () => {
    const events = [makeEvent()];
    expect(buildTeamCalendar(TEAM, events, NOW)).toBe(
      buildTeamCalendar(TEAM, events, NOW),
    );
  });
});
