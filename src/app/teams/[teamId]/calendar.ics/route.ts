import { getDb } from "@/db/server";
import { handleTeamCalendarRequest } from "@/lib/calendar/handler";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/teams/[teamId]/calendar.ics">,
) {
  const { teamId } = await ctx.params;
  return handleTeamCalendarRequest(getDb(), teamId);
}
