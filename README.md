# Sports Dashboard

Follow your favorite teams across sports in one place and subscribe to their upcoming matches in your calendar app via an iCal (`.ics`) feed. Also shows results, standings and news.

A non-commercial learning project for exploring modern web technologies and AI-assisted development.

## Getting started

Requires the Node version in [`.nvmrc`](.nvmrc).

```bash
npm ci
npm run db:reset   # creates the local database with sample data
npm run dev
```

Then open http://localhost:3000. The sample team's calendar feed is at http://localhost:3000/teams/riverside-fc/calendar.ics (upcoming matches only). To try it in a calendar app, download that file and import it (Google Calendar: Settings > Import & export; Apple Calendar: File > Import). Subscribing by URL needs the app to be published. Other commands (lint, typecheck, tests, build) are listed in [CLAUDE.md](CLAUDE.md#commands).

## Documentation

- [Product scope and user stories](docs/PRODUCT.md)
- [Data model and adapter contract](docs/DATA_MODEL.md)
- [Contributor and AI assistant guidelines](CLAUDE.md)

## Status

Early development. The app is scaffolded; features are being added story by story.
