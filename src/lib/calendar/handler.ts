import type { Db } from "@/db";
import { getTeam, getTeamEvents } from "@/db/queries";

import { buildTeamCalendar, eventDurationMs } from "./team-calendar";

/**
 * Response for GET /teams/[teamId]/calendar.ics: the team's upcoming matches,
 * including one that is in progress now. 404 if the team does not exist.
 */
export async function handleTeamCalendarRequest(
  db: Db,
  teamId: string,
  now: Date = new Date(),
): Promise<Response> {
  const team = await getTeam(db, teamId);
  if (!team) {
    return new Response("Team not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // An event stays in the feed until its calendar slot is over.
  const from = new Date(now.getTime() - eventDurationMs(team.sportId));
  const events = await getTeamEvents(db, team.id, from);

  // The ID comes from our own database, but keep the file name conservative.
  const fileName = team.id.replace(/[^A-Za-z0-9_-]/g, "_");

  return new Response(buildTeamCalendar(team, events, now), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${fileName}.ics"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
