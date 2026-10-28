# Data model

The common model that every sport adapter must produce. The website, the calendar feeds and the database only know about these shapes, never about a provider's response format.

This is a **first draft** meant to be challenged while implementing stories 1-2 and again when adding F1 (story 6). Change it when reality disagrees, and update this file in the same pull request.

## Design rules

1. All timestamps are stored in **UTC** (ISO 8601 / `timestamp` columns). Conversion to a local time zone happens only in the UI.
2. Every entity has our own internal ID. Provider IDs live in `ExternalRef`, never in the main tables.
3. Common fields cover what the calendar, lists and tables need. Sport-specific details go in a typed `details` JSON column validated with Zod.
4. A participant in an event is either a team or an individual athlete, so football matches (2 teams) and F1 races (20 drivers) use the same structure.

## Entities

```
Sport 1──* Competition 1──* Event 1──* EventParticipant *──1 Participant
                │   │                                            │
                │   ├──* Standing *──────────────────────────────┤
                │   └──* CompetitionEntry *──────────────────────┘
Participant 1──* NewsItem (via team link)
any entity 1──* ExternalRef
```

### Sport
| Field | Type | Notes |
|-------|------|-------|
| id | string | Stable slug: `football`, `f1`. |
| name | string | Display name. |

### Competition
A competition in a specific season (e.g. "Premier League 2026/27").

| Field | Type | Notes |
|-------|------|-------|
| id | string | Internal. |
| sportId | string | FK to Sport. |
| name | string | |
| season | string | e.g. `2026-27` or `2026`. |
| country | string? | ISO code or `INT` for international. |

### Participant
Anything that takes part in an event.

| Field | Type | Notes |
|-------|------|-------|
| id | string | Internal. |
| sportId | string | |
| kind | `team` \| `athlete` | A F1 constructor is a `team`; a driver is an `athlete`. |
| name | string | |
| shortName | string? | e.g. "ARS". |
| country | string? | |
| imageUrl | string? | Crest or photo. We link to it; we do not host it. |

An athlete's team is not stored here, because athletes change teams. Use `CompetitionEntry`.

### CompetitionEntry
Registers a participant in a competition for its season. This is what links an athlete to a team in a given season (e.g. a driver and a constructor in "Formula 1 2026"). It is also usable for team sports to list the teams of a competition.

| Field | Type | Notes |
|-------|------|-------|
| competitionId | string | |
| participantId | string | The athlete, or the team in team sports. |
| teamId | string? | For athletes: the team they represent in this competition. |
| number | string? | Racing or shirt number, when applicable. |
| validFrom / validTo | UTC timestamp? | Only needed for mid-season changes. |

### Event
One match, race or session.

| Field | Type | Notes |
|-------|------|-------|
| id | string | Internal. |
| competitionId | string | |
| startsAt | UTC timestamp | |
| timeConfirmed | boolean | `false` when the provider says "TBD". Calendar feeds mark these as tentative. |
| status | `scheduled` \| `live` \| `finished` \| `postponed` \| `cancelled` | |
| round | string? | "Matchday 12", "Quarter-final", "Monaco GP". |
| venue | string? | |
| details | JSON | Sport-specific, validated per sport (see below). |

### EventParticipant
Links participants to an event.

| Field | Type | Notes |
|-------|------|-------|
| eventId | string | |
| participantId | string | |
| role | `home` \| `away` \| `competitor` | Football uses home/away; F1 uses competitor. |
| outcome | JSON? | Per-participant result (score, finishing position, time). Sport-specific. |

### Standing
One row of a competition table.

| Field | Type | Notes |
|-------|------|-------|
| competitionId | string | |
| participantId | string | |
| rank | integer | |
| points | number | |
| stats | JSON | Sport-specific: played/won/drawn/lost/goals for football, wins for F1. |
| table | string | Which table of the competition this row belongs to: `league`, `Group A`, `drivers`, `constructors`. |
| updatedAt | UTC timestamp | |

A competition can have several tables. F1 has two per season (`drivers` and `constructors`), and its races belong to the single competition, not to either table.

### NewsItem
| Field | Type | Notes |
|-------|------|-------|
| id | string | |
| participantId | string | The team the item relates to. |
| title | string | |
| url | string | Link to the original article. |
| source | string | Publisher name. |
| publishedAt | UTC timestamp | |

We store the headline and link only, not article content.

### ExternalRef
Maps our entities to provider IDs, so data from different sources can refer to the same thing.

| Field | Type | Notes |
|-------|------|-------|
| entityType | `competition` \| `participant` \| `event` | |
| entityId | string | Our internal ID. |
| provider | string | e.g. `api-football`, `jolpica`. |
| externalId | string | The provider's ID. |

Unique on `(provider, entityType, externalId)`. Adapters use it to upsert instead of creating duplicates.

## Sport-specific details

Validated with Zod discriminated unions on `sportId`. Starting shapes:

```ts
// Football
type FootballEventDetails = {
  halftimeScore?: { home: number; away: number };
  penalties?: { home: number; away: number };
};
type FootballOutcome = { score: number | null };
type FootballStanding = {
  played: number; won: number; drawn: number; lost: number;
  goalsFor: number; goalsAgainst: number;
};

// F1
type F1EventDetails = { session: "race" | "qualifying" | "sprint" | "practice" };
type F1Outcome = { position: number | null; status: string; points?: number };
type F1Standing = { wins: number };
```

## Open questions

- **Grouping F1 sessions into a race weekend.** Grouping by the free-text `round` is fragile. Decide in the F1 story whether to add a weekend identifier or a parent event.
- **Mid-season team changes** (`validFrom` / `validTo` on `CompetitionEntry`): keep only if a provider actually exposes them.

## Adapter contract

Each provider has one adapter. Adapters fetch, validate the raw response with Zod, and return normalized data. They do not write to the database; the sync script does.

```ts
interface SportAdapter {
  provider: string;
  fetchCompetitions(): Promise<NormalizedCompetition[]>;
  fetchEvents(competitionId: string): Promise<NormalizedEvent[]>;
  fetchStandings(competitionId: string): Promise<NormalizedStanding[]>;
}
```

Rules for adapters:

- Convert all times to UTC.
- Fail loudly with the failing field when the provider response does not match the expected schema.
- Keep provider quirks inside the adapter.
- Be testable with saved sample responses (fixtures), without network access.
