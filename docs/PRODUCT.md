# Product

## Purpose

Sports Dashboard lets a user follow their favorite teams across sports and competitions in one place, and get upcoming matches in their own calendar app through a subscribable iCal feed.


## Target user

A sports fan who follows one or a few teams, possibly in different sports, and wants fixtures, results, standings and news without opening several apps.

## MVP scope

The MVP is a public site with **no user accounts**. Everything is addressed by URL, for example a team page or a team calendar feed.

In scope:

- Football as the first sport, F1 as the second (to validate that the data model fits two very different sports).
- Team pages with upcoming fixtures and recent results.
- Competition standings.
- A subscribable `.ics` calendar feed per team.
- News headlines per team, linked to the original source.

## Out of scope (for now)

- User accounts, login, saved favorites, preferences.
- Push, email or any other notifications.
- Live, minute-by-minute scores. Data may be a few minutes to a few hours old.
- More than two sports.
- Native mobile apps.
- Anything commercial: monetization, ads, paid data licenses.

## Principles

- **The website never calls external APIs.** It reads only from our database. A separate sync process fetches and normalizes external data.
- **One common data model** for all sports, with sport-specific details isolated (see [DATA_MODEL.md](DATA_MODEL.md)).
- **Everything is stored in UTC** and converted to the viewer's time zone only when displayed.
- **Understand what we merge.** AI-generated code is reviewed by a human who can explain it.

## How stories are delivered

- A story is written from the user's point of view and has acceptance criteria. Technical detail does not go in the story statement.
- A story is delivered as **one or more pull requests**. The "Planned PRs" column is a first guess at the split, to be confirmed in the plan made when the story is picked up.
- Each PR should be reviewable in about 20-30 minutes and leave `master` working.
- Schema changes go in their own small PR and are merged quickly, to avoid conflicting migrations between parallel branches.

## User stories

Stories are ordered. Each row lists acceptance criteria and the planned PR split.

### 1. Team calendar feed from sample data

*As a fan, I can open a URL and get an `.ics` file with a team's upcoming matches.*

Acceptance criteria:
- The feed is generated from the database, which contains sample data.
- It imports correctly into Google Calendar and Apple Calendar.
- Events with an unconfirmed time are marked tentative.

Planned PRs:
1. Project scaffold: Next.js, TypeScript strict, Tailwind, shadcn/ui, ESLint, Prettier, Vitest, GitHub Actions CI.
2. Database: libSQL client, Drizzle, schema from `DATA_MODEL.md`, first migration, seed script with sample data.
3. Feed endpoint and tests (`ical-generator`).

### 2. Real football data

*As a developer, the football adapter fetches matches from the data provider and stores them in the database, so the feed shows real matches.*

Acceptance criteria:
- Running the sync script populates the database and the feed from story 1 shows real matches.
- Running it twice does not create duplicates.
- An invalid provider response fails with an error naming the offending field.
- A changed match time updates the existing event.

Planned PRs:
1. Data spike (docs and fixtures only): choose the provider and league, save real sample responses as fixtures, check they fit the model, and record any model changes needed in `DATA_MODEL.md`. Do the same check against a Jolpica sample, so the model is tested against F1 early.
2. Adapter with Zod schemas, tested against the fixtures.
3. Sync script: upserts using `ExternalRef`, API key from environment, `.env.example`.

### 3. Team page

*As a fan, I can see a team page with upcoming fixtures and recent results.*

Acceptance criteria:
- The page is rendered from the database only.
- Times are shown in the viewer's time zone.
- There is a way to find and open a team.

Planned PRs:
1. Team list and team page with upcoming fixtures.
2. Recent results and time zone display.

### 4. Standings

*As a fan, I can see the standings of a competition.*

Acceptance criteria:
- The table shows rank, points and the core stats for the current season.
- It is filled by the sync and rendered from the database.

Planned PRs: 1-2 (adapter and sync for standings, then the table UI).

### 5. News

*As a fan, I can read recent news about a team.*

Acceptance criteria:
- Headlines link to the original article and show the source and date.
- Repeated syncs do not duplicate items.

Planned PRs: 1 (RSS fetch in the sync, storage, list on the team page).

### 6. Formula 1

*As a fan, I can follow a F1 driver or constructor the same way as a football team.*

Acceptance criteria:
- Race weekend sessions appear in calendar feeds.
- Driver and constructor standings are shown.
- No football-specific code was changed to support it, other than agreed model changes.

Planned PRs:
1. Jolpica adapter, plus the model changes it needs and their migration.
2. Race weekend and F1 standings UI.

## Data sources

Initial choices; each is isolated behind an adapter, so they can be swapped.

| Need | Source | Notes |
|------|--------|-------|
| Football fixtures, results, standings | To be chosen in the story 2 spike (candidates: API-Football, football-data.org, ESPN unofficial API) | Check free-tier limits and league coverage first. |
| F1 | Jolpica (Ergast-compatible) | Free, no API key. |
| News | RSS (Google News search feeds, club and media feeds) | Show headline and link only, never full article content. |

## Open questions

- Which football provider and which league do we start with? (Decided in the story 2 spike.)
- Where do we deploy, if anywhere? Candidates: a host with a persistent disk (Fly.io, Railway, a VPS) running SQLite as a file; Turso (hosted libSQL) with the same code; or hosted Postgres, which would require rewriting the schema. Not needed before there is something to publish.
- How often should the sync run, and where (GitHub Actions schedule, a server cron)? This depends on the deployment choice.
