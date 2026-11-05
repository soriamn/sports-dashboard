import ical, { ICalEventStatus } from "ical-generator";

import type { Team, TeamEvent } from "@/db/queries";

const HOUR_MS = 60 * 60 * 1000;

// The provider data has no end time, so events get a fixed length per sport.
const EVENT_DURATION_MS: Record<string, number> = {
  football: 2 * HOUR_MS,
};
const DEFAULT_EVENT_DURATION_MS = 2 * HOUR_MS;

/** How long an event of this sport lasts in the calendar. */
export function eventDurationMs(sportId: string): number {
  return EVENT_DURATION_MS[sportId] ?? DEFAULT_EVENT_DURATION_MS;
}

// Calendar apps may ignore this; Google Calendar refreshes every 12-24 hours.
const REFRESH_SECONDS = 6 * 60 * 60;

/** Event title: "Home vs Away", with a prefix or suffix for special states. */
export function eventSummary(e: TeamEvent): string {
  const sides = e.participants.map((p) => p.name);
  let title = e.participants.some((p) => p.role !== "competitor")
    ? sides.join(" vs ")
    : sides.join(", ");
  if (e.status === "cancelled") title = `[Cancelled] ${title}`;
  if (e.status === "postponed") title = `[Postponed] ${title}`;
  if (!e.timeConfirmed) title = `${title} (time TBC)`;
  return title;
}

function eventDescription(e: TeamEvent): string {
  const lines = [
    e.round ? `${e.competitionName} · ${e.round}` : e.competitionName,
  ];
  if (!e.timeConfirmed)
    lines.push("The kickoff time is still to be confirmed.");
  return lines.join("\n");
}

function eventStatus(e: TeamEvent): ICalEventStatus {
  if (e.status === "cancelled") return ICalEventStatus.CANCELLED;
  if (e.status === "postponed" || !e.timeConfirmed) {
    return ICalEventStatus.TENTATIVE;
  }
  return ICalEventStatus.CONFIRMED;
}

/**
 * Builds the iCalendar (.ics) text for a team's events. Pure: `now` is only
 * used for the DTSTAMP of each event.
 */
export function buildTeamCalendar(
  team: Team,
  events: TeamEvent[],
  now: Date,
): string {
  const calendar = ical({
    name: `${team.name} fixtures`,
    description: `Upcoming matches of ${team.name}`,
    prodId: { company: "sports-dashboard", product: "team-calendar" },
    ttl: REFRESH_SECONDS,
  });

  const durationMs = eventDurationMs(team.sportId);
  for (const e of events) {
    calendar.createEvent({
      // Stable, so calendar apps update the event instead of duplicating it.
      id: `${e.id}@sports-dashboard`,
      stamp: now,
      start: e.startsAt,
      end: new Date(e.startsAt.getTime() + durationMs),
      summary: eventSummary(e),
      description: eventDescription(e),
      location: e.venue,
      status: eventStatus(e),
    });
  }

  return calendar.toString();
}
