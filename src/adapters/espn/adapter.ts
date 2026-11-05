import type { z } from "zod";

import {
  footballEventDetailsSchema,
  footballOutcomeSchema,
  footballStandingSchema,
} from "../football";
import { AdapterError, parseResponse } from "../errors";
import type {
  NormalizedCompetition,
  NormalizedEvent,
  NormalizedParticipant,
  NormalizedStanding,
  SportAdapter,
} from "../types";
import { LEAGUES, type LeagueConfig } from "./leagues";
import {
  competitionExternalId,
  mapStatus,
  parseCompetitionExternalId,
  roundFromSeasonSlug,
  seasonCalendarYears,
  seasonLabel,
} from "./mapping";
import {
  scoreboardSchema,
  standingsSchema,
  type EspnEvent,
  type EspnStandings,
} from "./schemas";

const PROVIDER = "espn";
const SCOREBOARD_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
// Standings live under a different path (/apis/v2, not /apis/site/v2).
const STANDINGS_BASE = "https://site.api.espn.com/apis/v2/sports/soccer";

type EspnAdapterOptions = {
  // Injected so tests can serve saved responses instead of calling the network.
  fetch?: typeof fetch;
};

export function createEspnAdapter(
  options: EspnAdapterOptions = {},
): SportAdapter {
  const doFetch = options.fetch ?? fetch;

  async function getJson<T>(
    url: string,
    schema: z.ZodType<T>,
    context: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(url);
    } catch (error) {
      throw new AdapterError(`${context}: request to ${url} failed`, {
        cause: error,
      });
    }
    if (!response.ok) {
      throw new AdapterError(`${context}: HTTP ${response.status} for ${url}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new AdapterError(`${context}: response is not valid JSON`, {
        cause: error,
      });
    }
    return parseResponse(schema, body, context);
  }

  function leagueFor(competitionId: string) {
    const parsed = parseCompetitionExternalId(competitionId);
    const league = LEAGUES.find((l) => l.slug === parsed?.slug);
    if (!parsed || !league) {
      throw new AdapterError(
        `espn: unknown competition "${competitionId}" (expected one of ${LEAGUES.map((l) => `${l.slug}:<year>`).join(", ")})`,
      );
    }
    return { league, year: parsed.year };
  }

  return {
    provider: PROVIDER,

    // One request per league, to learn which season is the current one.
    async fetchCompetitions(): Promise<NormalizedCompetition[]> {
      const competitions: NormalizedCompetition[] = [];
      for (const league of LEAGUES) {
        const board = await getJson(
          `${SCOREBOARD_BASE}/${league.slug}/scoreboard`,
          scoreboardSchema,
          `espn ${league.slug} scoreboard`,
        );
        const year = board.leagues[0].season.year;
        competitions.push({
          externalId: competitionExternalId(league.slug, year),
          sportId: "football",
          name: league.name,
          season: seasonLabel(year, league.seasonFormat),
          country: league.country,
        });
      }
      return competitions;
    },

    // ESPN does not accept date ranges, so we ask for whole calendar years and
    // keep only the events of the requested season.
    async fetchEvents(competitionId: string): Promise<NormalizedEvent[]> {
      const { league, year } = leagueFor(competitionId);
      const events: NormalizedEvent[] = [];

      for (const calendarYear of seasonCalendarYears(
        year,
        league.seasonFormat,
      )) {
        const context = `espn ${league.slug} scoreboard ${calendarYear}`;
        const board = await getJson(
          `${SCOREBOARD_BASE}/${league.slug}/scoreboard?dates=${calendarYear}&limit=500`,
          scoreboardSchema,
          context,
        );
        board.events.forEach((raw, index) => {
          if (raw.season.year !== year) return;
          events.push(
            toEvent(raw, competitionId, league, `${context} events[${index}]`),
          );
        });
      }

      return events.sort(
        (a, b) =>
          a.startsAt.getTime() - b.startsAt.getTime() ||
          a.externalId.localeCompare(b.externalId),
      );
    },

    async fetchStandings(competitionId: string): Promise<NormalizedStanding[]> {
      const { league, year } = leagueFor(competitionId);
      const context = `espn ${league.slug} standings`;
      const data = await getJson(
        `${STANDINGS_BASE}/${league.slug}/standings`,
        standingsSchema,
        context,
      );
      // ESPN only serves the current season's table.
      if (data.season.year !== year) {
        throw new AdapterError(
          `${context}: ESPN returned season ${data.season.year}, but ${competitionId} was requested`,
        );
      }
      return toStandings(data, competitionId, context);
    },
  };
}

function toEvent(
  raw: EspnEvent,
  competitionId: string,
  league: LeagueConfig,
  context: string,
): NormalizedEvent {
  const competition = raw.competitions[0];
  const { status, extraTime } = mapStatus(
    raw.status.type.name,
    raw.status.type.state,
    context,
  );
  // Scores are only meaningful once the match has started.
  const hasScore = status === "live" || status === "finished";

  return {
    externalId: raw.id,
    competitionExternalId: competitionId,
    startsAt: raw.date,
    timeConfirmed: competition.timeValid,
    status,
    round: roundFromSeasonSlug(raw.season.slug, league.seasonFormat),
    venue: competition.venue?.fullName ?? null,
    details: footballEventDetailsSchema.parse({ extraTime }),
    participants: competition.competitors.map((c) => ({
      participant: toParticipant(c.team),
      role: c.homeAway,
      outcome: hasScore
        ? footballOutcomeSchema.parse({
            score: c.score,
            shootoutScore: c.shootoutScore,
          })
        : null,
    })),
  };
}

function toParticipant(team: {
  id: string;
  displayName: string;
  abbreviation?: string;
  logo?: string;
}): NormalizedParticipant {
  return {
    externalId: team.id,
    kind: "team",
    name: team.displayName,
    shortName: team.abbreviation ?? null,
    imageUrl: team.logo ?? null,
  };
}

function toStandings(
  data: EspnStandings,
  competitionId: string,
  context: string,
): NormalizedStanding[] {
  const rows: NormalizedStanding[] = [];

  data.children.forEach((child, childIndex) => {
    // European leagues have one table; Argentina has "Group A" and "Group B".
    const table = data.children.length === 1 ? "league" : child.name;

    child.standings.entries.forEach((entry, entryIndex) => {
      const where = `${context}: children[${childIndex}].standings.entries[${entryIndex}]`;
      const stat = (name: string) => {
        const value = entry.stats.find((s) => s.name === name)?.value;
        if (value === undefined) {
          throw new AdapterError(
            `${where}.stats: invalid field "${name}": missing`,
          );
        }
        return value;
      };

      rows.push({
        competitionExternalId: competitionId,
        participant: toParticipant({
          ...entry.team,
          logo: entry.team.logos?.[0]?.href,
        }),
        table,
        rank: stat("rank"),
        points: stat("points"),
        stats: parseResponse(
          footballStandingSchema,
          {
            played: stat("gamesPlayed"),
            won: stat("wins"),
            drawn: stat("ties"),
            lost: stat("losses"),
            goalsFor: stat("pointsFor"),
            goalsAgainst: stat("pointsAgainst"),
          },
          `${where}.stats`,
        ),
      });
    });
  });

  return rows;
}
