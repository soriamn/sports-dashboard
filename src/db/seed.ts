import type { Db } from "./index";
import {
  competition,
  event,
  eventParticipant,
  participant,
  sport,
  type EventStatus,
} from "./schema";

// Sample data for development and tests. Teams and the league are fictional.
// Dates are relative to `now`, so the "upcoming" matches are always upcoming.

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const COMPETITION_ID = "sample-league-2026-27";

const teams = [
  { id: "riverside-fc", name: "Riverside FC", shortName: "RIV" },
  { id: "harbor-united", name: "Harbor United", shortName: "HAR" },
  { id: "mountain-athletic", name: "Mountain Athletic", shortName: "MTN" },
  { id: "valley-rovers", name: "Valley Rovers", shortName: "VAL" },
  { id: "coastal-city", name: "Coastal City", shortName: "COA" },
  { id: "northgate-town", name: "Northgate Town", shortName: "NOR" },
];

type SampleMatch = {
  id: string;
  daysFromNow: number;
  hourUtc: number;
  round: string;
  home: string;
  away: string;
  venue?: string;
  status?: EventStatus;
  timeConfirmed?: boolean;
  score?: { home: number; away: number };
};

const matches: SampleMatch[] = [
  // Finished, with results.
  {
    id: "match-01",
    daysFromNow: -14,
    hourUtc: 15,
    round: "Matchday 1",
    home: "riverside-fc",
    away: "harbor-united",
    venue: "Riverside Park",
    status: "finished",
    score: { home: 2, away: 1 },
  },
  {
    id: "match-02",
    daysFromNow: -7,
    hourUtc: 18,
    round: "Matchday 2",
    home: "valley-rovers",
    away: "riverside-fc",
    venue: "Valley Ground",
    status: "finished",
    score: { home: 0, away: 0 },
  },
  {
    id: "match-03",
    daysFromNow: -7,
    hourUtc: 15,
    round: "Matchday 2",
    home: "coastal-city",
    away: "northgate-town",
    status: "finished",
    score: { home: 3, away: 2 },
  },
  // Upcoming.
  {
    id: "match-04",
    daysFromNow: 3,
    hourUtc: 19,
    round: "Matchday 3",
    home: "riverside-fc",
    away: "mountain-athletic",
    venue: "Riverside Park",
  },
  {
    id: "match-05",
    daysFromNow: 3,
    hourUtc: 15,
    round: "Matchday 3",
    home: "harbor-united",
    away: "coastal-city",
  },
  {
    id: "match-06",
    daysFromNow: 10,
    hourUtc: 14,
    round: "Matchday 4",
    home: "northgate-town",
    away: "riverside-fc",
    venue: "Northgate Stadium",
  },
  {
    // Kickoff time not confirmed yet: the hour is a placeholder.
    id: "match-07",
    daysFromNow: 17,
    hourUtc: 12,
    round: "Matchday 5",
    home: "riverside-fc",
    away: "valley-rovers",
    venue: "Riverside Park",
    timeConfirmed: false,
  },
  {
    id: "match-08",
    daysFromNow: 5,
    hourUtc: 16,
    round: "Matchday 3",
    home: "mountain-athletic",
    away: "valley-rovers",
    status: "postponed",
    timeConfirmed: false,
  },
];

/**
 * Replaces the contents of the database with the sample data. Destructive on
 * purpose: it is meant for local and test databases only.
 */
export async function seed(db: Db, now: Date = new Date()) {
  const todayUtc = Math.floor(now.getTime() / DAY_MS) * DAY_MS;

  await db.transaction(async (tx) => {
    // Children first, to respect foreign keys.
    await tx.delete(eventParticipant);
    await tx.delete(event);
    await tx.delete(participant);
    await tx.delete(competition);
    await tx.delete(sport);

    await tx.insert(sport).values({ id: "football", name: "Football" });
    await tx.insert(competition).values({
      id: COMPETITION_ID,
      sportId: "football",
      name: "Sample League",
      season: "2026-27",
    });
    await tx.insert(participant).values(
      teams.map((t) => ({
        ...t,
        sportId: "football",
        kind: "team" as const,
      })),
    );

    for (const m of matches) {
      await tx.insert(event).values({
        id: m.id,
        competitionId: COMPETITION_ID,
        startsAt: new Date(
          todayUtc + m.daysFromNow * DAY_MS + m.hourUtc * HOUR_MS,
        ),
        timeConfirmed: m.timeConfirmed ?? true,
        status: m.status ?? "scheduled",
        round: m.round,
        venue: m.venue ?? null,
      });
      await tx.insert(eventParticipant).values([
        {
          eventId: m.id,
          participantId: m.home,
          role: "home",
          outcome: m.score ? { score: m.score.home } : null,
        },
        {
          eventId: m.id,
          participantId: m.away,
          role: "away",
          outcome: m.score ? { score: m.score.away } : null,
        },
      ]);
    }
  });

  return { teams: teams.length, events: matches.length };
}
