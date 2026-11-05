import { and, asc, eq, gte, inArray } from "drizzle-orm";

import type { Db } from "./index";
import {
  competition,
  event,
  eventParticipant,
  participant,
  type EventStatus,
  type ParticipantRole,
} from "./schema";

export type Team = {
  id: string;
  sportId: string;
  name: string;
};

export type TeamEvent = {
  id: string;
  startsAt: Date;
  timeConfirmed: boolean;
  status: EventStatus;
  round: string | null;
  venue: string | null;
  competitionName: string;
  participants: { id: string; name: string; role: ParticipantRole }[];
};

/** Finds a participant that is a team, or null (also for athletes). */
export async function getTeam(db: Db, teamId: string): Promise<Team | null> {
  const [row] = await db
    .select({
      id: participant.id,
      sportId: participant.sportId,
      name: participant.name,
    })
    .from(participant)
    .where(and(eq(participant.id, teamId), eq(participant.kind, "team")));
  return row ?? null;
}

/**
 * The team's events starting at or after `from`, soonest first, each with all
 * of its participants (home side first).
 */
export async function getTeamEvents(
  db: Db,
  teamId: string,
  from: Date,
): Promise<TeamEvent[]> {
  const rows = await db
    .select({
      id: event.id,
      startsAt: event.startsAt,
      timeConfirmed: event.timeConfirmed,
      status: event.status,
      round: event.round,
      venue: event.venue,
      competitionName: competition.name,
    })
    .from(eventParticipant)
    .innerJoin(event, eq(event.id, eventParticipant.eventId))
    .innerJoin(competition, eq(competition.id, event.competitionId))
    .where(
      and(
        eq(eventParticipant.participantId, teamId),
        gte(event.startsAt, from),
      ),
    )
    .orderBy(asc(event.startsAt), asc(event.id));

  if (rows.length === 0) return [];

  const people = await db
    .select({
      eventId: eventParticipant.eventId,
      id: participant.id,
      name: participant.name,
      role: eventParticipant.role,
    })
    .from(eventParticipant)
    .innerJoin(participant, eq(participant.id, eventParticipant.participantId))
    .where(
      inArray(
        eventParticipant.eventId,
        rows.map((r) => r.id),
      ),
    );

  // Home first, then away, then competitors; names break ties.
  const roleOrder: Record<ParticipantRole, number> = {
    home: 0,
    away: 1,
    competitor: 2,
  };

  return rows.map((row) => ({
    ...row,
    participants: people
      .filter((p) => p.eventId === row.id)
      .map(({ id, name, role }) => ({ id, name, role }))
      .sort(
        (a, b) =>
          roleOrder[a.role] - roleOrder[b.role] || a.name.localeCompare(b.name),
      ),
  }));
}
