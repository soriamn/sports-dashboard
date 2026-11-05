# Data provider spike

Result of the spike that opens story 2 ("Real football data"). It records which football provider we chose and why, how a real response maps to the common model in [DATA_MODEL.md](DATA_MODEL.md), and what has to change in the model. Nothing here is production code: the deliverables are this document and the saved fixtures.

Date of the spike: 2026-11-05. Provider behavior may have changed since.

## Leagues we need

Argentine Liga Profesional, Premier League, La Liga and Serie A. Fixtures, results and standings for the current season.

## Provider comparison

| Provider                | Argentina | Premier | La Liga | Serie A | Verdict                                                                                                                                                     |
| ----------------------- | --------- | ------- | ------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESPN (unofficial)       | yes       | yes     | yes     | yes     | **Chosen.** Free, no key, covers all four, has the current season.                                                                                          |
| API-Football, free plan | -         | -       | -       | -       | Rejected. Tested with a real key: fixtures and standings for 2025 and 2026 fail with `Free plans do not have access to this season, try from 2022 to 2024`. |
| API-Football, paid      | yes       | yes     | yes     | yes     | Works, but costs money (about USD 19/month, from their pricing page, not verified). Kept as the fallback if ESPN breaks.                                    |
| football-data.org, free | **no**    | yes     | yes     | yes     | Rejected. `GET /v4/competitions` lists `plan` per competition: Liga Profesional is `TIER_TWO` (paid); the free plan is `TIER_ONE` (12 competitions).        |
| TheSportsDB, free       | ?         | ?       | ?       | ?       | Rejected without testing: third-party sources report about 5 events per day per league on the free key.                                                     |

### Risks of choosing ESPN

- **It is not an official API.** There is no documentation, no stability promise and no published terms for third-party use. It can change or be blocked without notice.
- **Mitigation:** the adapter validates every response with Zod and fails with the offending field. Fixtures make format changes visible in tests. The provider sits behind `SportAdapter`, so API-Football (paid) can replace it without touching the rest of the app.
- Non-commercial use and low request volume (a few requests per league per sync) keep our footprint small. We link to ESPN's logos and do not host them.

## ESPN endpoints

Base URL for fixtures: `https://site.api.espn.com/apis/site/v2/sports/soccer/{league}`. Base URL for standings: `https://site.api.espn.com/apis/v2/sports/soccer/{league}` (note: `/apis/v2`, not `/apis/site/v2`). League slugs: `arg.1`, `eng.1`, `esp.1`, `ita.1`.

| Need            | Request                             | Notes                                                                                                           |
| --------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| All fixtures    | `/scoreboard?dates=2026&limit=500`  | One call returns a whole **calendar year** (374 events for the Premier League). Without `limit` it returns 100. |
| Standings       | `/standings`                        | Current season only.                                                                                            |
| One team's list | `/teams/{id}/schedule?fixture=true` | Upcoming matches of one team. Useful, but not needed if we sync whole leagues.                                  |

Findings about the requests:

- **Date ranges do not work.** `dates=20261101-20261130` answers `400 Failed to get events endpoint`, with every range format tried. Single days (`dates=20261107`) and whole years work. The sync must request the year and filter.
- **European seasons span two calendar years**, so `dates=2026` returns the tail of 2025-26 and the start of 2026-27 together (194 and 180 events for the Premier League). Filter by `event.season.year` (and `season.slug`), and request the next year too when a season crosses the new year.
- The server answers gzip-compressed even when not asked; real HTTP clients handle it, `curl` needs `--compressed`.
- No API key and no documented rate limit. We keep requests few and sequential.

## Fixtures

Saved in `src/adapters/espn/__fixtures__/` and `src/adapters/jolpica/__fixtures__/`. They are raw provider responses and are excluded from Prettier so they stay byte-faithful (JSON re-indented only).

| File                              | Content                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `scoreboard-{league}.json`        | The real scoreboard response with `events` reduced to 4-8 hand-picked ones (see below). The rest of the response is untouched. |
| `standings-{league}.json`         | Full, untouched standings response.                                                                                            |
| Jolpica `schedule-2026.json` etc. | Full, untouched responses: season calendar, driver and constructor standings, results and qualifying of round 1.               |

Events kept in each scoreboard fixture: two finished matches, the next and the last scheduled ones; plus a match with an unconfirmed time and an abandoned match (`esp.1`); plus extra time, a penalty shootout and a playoff final (`arg.1`). The `arg.1` and `esp.1` files are therefore the ones that exercise the edge cases.

## Mapping ESPN to the model

| Model                                     | ESPN field                                                            | Fit                                                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Event.startsAt`                          | `event.date` (`"2026-11-06T20:00Z"`)                                  | Direct. Already UTC, but **without seconds**; `new Date()` parses it.                                                     |
| `Event.timeConfirmed`                     | `competitions[0].timeValid`                                           | Direct. `false` on 40 of 379 `esp.1` events (future matches without a fixed kickoff). Always `true` in the other leagues. |
| `Event.status`                            | `status.type.name` / `state`                                          | Needs a mapping, see below.                                                                                               |
| `Event.venue`                             | `competitions[0].venue.fullName`                                      | Direct. Present on all 1,622 events checked.                                                                              |
| `Event.round`                             | none                                                                  | **Gap.** League matches have no matchday. See below.                                                                      |
| `EventParticipant.role`                   | `competitors[].homeAway`                                              | Direct: `home` / `away`.                                                                                                  |
| `EventParticipant.outcome`                | `competitors[].score` (string), `shootoutScore`                       | Convert the string score to a number. Shootout score exists only on penalty-decided matches.                              |
| `Participant.name / shortName / imageUrl` | `team.displayName / abbreviation / logo`                              | Direct.                                                                                                                   |
| `Participant.country`                     | none on the event                                                     | Not available in the scoreboard. Leave null.                                                                              |
| `ExternalRef` (event / participant)       | `event.id`, `team.id`                                                 | Direct. Provider name `espn`.                                                                                             |
| `ExternalRef` (competition)               | league slug (`eng.1`) plus `season.year`                              | Works, see "Competitions" below.                                                                                          |
| `Standing.rank / points`                  | `stats` entries `rank`, `points`                                      | Direct.                                                                                                                   |
| `FootballStanding`                        | `gamesPlayed`, `wins`, `ties`, `losses`, `pointsFor`, `pointsAgainst` | Direct (`ties` = `drawn`, `pointsFor/Against` = goals). Values come as a `stats` array of `{name, value}`, not an object. |
| `Standing.table`                          | `children[].name`                                                     | Direct. `league` for the European leagues; `Group A` / `Group B` for Argentina.                                           |

### Status mapping

Seen in the fixtures:

| ESPN `status.type.name` | `state` | Model status                     |
| ----------------------- | ------- | -------------------------------- |
| `STATUS_SCHEDULED`      | `pre`   | `scheduled`                      |
| `STATUS_FULL_TIME`      | `post`  | `finished`                       |
| `STATUS_FINAL_AET`      | `post`  | `finished` (after extra time)    |
| `STATUS_FINAL_PEN`      | `post`  | `finished` (after penalties)     |
| `STATUS_ABANDONED`      | `post`  | **Undecided**, see model changes |

Not observed because no such match existed on the day of the spike: live (`state: "in"`), postponed and cancelled. The adapter must not guess their names. It should map by `state` where possible (`pre`, `in`, `post`) and **fail loudly on an unknown `status.type.name`** instead of silently treating it as scheduled.

### Competitions

- European leagues: one competition per season, named by `season.slug` (`2026-27-english-premier-league`). Straightforward.
- **Argentina is not one competition per year.** The 2026 season is two tournaments (`torneo-apertura`, `torneo-clausura`) plus playoff stages (`apertura---round-of-16`, `---quarterfinals`, `---semifinals`, `---final`), all sharing `season.year: 2026`. Standings come as two zones (`Group A`, `Group B`) for the current tournament only. This still fits the model if we treat "Liga Profesional 2026" as one competition and keep the tournament and stage in `Event.round` (for example `Clausura` or `Apertura - Final`).

### Rounds

ESPN gives **no matchday** for league matches (`week` is absent and `notes` is empty). The only stage information is in `event.season.slug` for the Argentine playoffs. So `Event.round` is null for ordinary league matches. This is acceptable for the calendar feed (stage 1 does not use it) but the team page cannot say "Matchday 12" unless we derive it later.

## Mapping Jolpica (F1) to the model

Calendar response: 23 races for 2026, with a nested object per session (`FirstPractice`, `SecondPractice`, `ThirdPractice`, `Qualifying`, and on sprint weekends `SprintQualifying` and `Sprint`), each with `date` and `time` in UTC. The race itself is the top-level `date`/`time`.

| Model                      | Jolpica field                                                   | Fit                                                                                                       |
| -------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `Competition`              | the season (`2026`)                                             | One competition per season, as in the model.                                                              |
| `Event` (one per session)  | `Races[].{FirstPractice, ..., Qualifying, Sprint}` and the race | Works, but one provider "race" becomes up to 6 events. `details.session` is derived from the key name.    |
| `Event.startsAt`           | `date` + `time` (`"2026-03-08"` + `"04:00:00Z"`)                | Combine the two strings. Always present in this sample, so `timeConfirmed` is `true`.                     |
| `Event.round`              | `raceName`                                                      | Direct ("Australian Grand Prix"), which is also the only link between sessions of one weekend.            |
| `Event.venue`              | `Circuit.circuitName` plus `Location`                           | Direct.                                                                                                   |
| `Participant` (athlete)    | `Driver` (`driverId`, `givenName`, `familyName`, `code`)        | Direct. `shortName` = `code`. No image.                                                                   |
| `Participant` (team)       | `Constructor`                                                   | Direct.                                                                                                   |
| `CompetitionEntry`         | `DriverStandings[].Constructors[]`, `Results[].Constructor`     | Needed: a driver's team comes only from standings or results. The table is not in the schema yet.         |
| `EventParticipant.outcome` | `Results[]` (`position`, `status`, `points`, `grid`, `Time`)    | Fits `F1Outcome`. Everything is a string (`"25"`, `"1"`) and must be converted.                           |
| `Standing`                 | `DriverStandings[]`, `ConstructorStandings[]`                   | Two tables, `drivers` and `constructors`, as the model already says. `wins` fits `F1Standing`.            |
| `ExternalRef`              | `driverId`, `constructorId`, `season` + `round`                 | Participants map directly. A race has **no id**: it is identified by `season` + `round` (+ session name). |

Observations:

- The sample was taken in the middle of the season (standings after round 19 of 23), so results and standings are for a season in progress.
- Result statuses seen in round 1: `Finished`, `Lapped`, `Retired`, `Did not start`. `F1Outcome.status` is a free string, so this fits.
- Session **times** all come in the season calendar, but session **results** are separate endpoints (`/results`, `/qualifying`, and so on). Only the race and qualifying results were sampled.

## Model changes needed

These are recorded as proposals. They should be applied in the PRs that need them (adapter and sync for football, the F1 PR for F1), not in this spike.

1. **Football standings arrive as a `stats` array**, not a flat object. The adapter converts them to `FootballStanding`. No model change.
2. **Add a status for abandoned or suspended matches, or decide the mapping.** `STATUS_ABANDONED` is not one of `scheduled | live | finished | postponed | cancelled`. Recommendation: map it to `postponed`, because an abandoned match is usually replayed, and keep the original `status.type.name` out of the model. To be confirmed in the adapter PR once more real examples exist.
3. **Penalty shootouts belong with the participant.** ESPN reports the shootout per competitor (`shootoutScore`), while the draft puts `penalties: {home, away}` in the event `details`. Proposal: keep `FootballOutcome = { score: number | null; shootoutScore?: number }` and drop `penalties` from `FootballEventDetails`. Extra time is only visible in the status (`STATUS_FINAL_AET`); store `extraTime: boolean` in `FootballEventDetails` if the UI needs it.
4. **`Event.round` is null for most league matches.** The field is already optional, so no schema change, but `PRODUCT.md` should not promise "Matchday N" in the UI.
5. **A weekend identifier for F1.** Jolpica gives nothing to group sessions except `season` + `round`. This is the open question already in `DATA_MODEL.md`. Recommendation: when adding F1, store `season-round` in `details` (or a dedicated `weekend` column) and let `ExternalRef` of the session carry `{season}/{round}/{session}`. The decision stays for the F1 story.
6. **`CompetitionEntry` is required for F1** to know a driver's team, as the model already anticipates. It is not needed for football.
7. **`ExternalRef` for a competition needs a composite key** for ESPN: league slug plus season year (`eng.1:2026`), because ESPN has no id for "competition in a season".
8. **Everything numeric arrives as a string** in both providers (`"2"`, `"25"`). Zod schemas must coerce explicitly, not with `z.coerce` on unknown input.

## What this spike did not check

- Live and postponed matches (none available that day).
- How often ESPN changes the format, and whether it blocks automated clients over time.
- Jolpica rate limits and behavior when a race time is unconfirmed (all 23 had times).
- ESPN news. Story 5 uses RSS and is unrelated.
