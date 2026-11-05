import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// Schema for the common data model described in docs/DATA_MODEL.md.
// Only the tables needed so far exist; Standing, NewsItem, CompetitionEntry and
// ExternalRef are added with the stories that need them.
//
// All timestamps are UTC, stored as milliseconds since the epoch.

export const PARTICIPANT_KINDS = ["team", "athlete"] as const;
export const EVENT_STATUSES = [
  "scheduled",
  "live",
  "finished",
  "postponed",
  "cancelled",
] as const;
export const PARTICIPANT_ROLES = ["home", "away", "competitor"] as const;

export type ParticipantKind = (typeof PARTICIPANT_KINDS)[number];
export type EventStatus = (typeof EVENT_STATUSES)[number];
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

// Sport-specific JSON. Typed loosely for now; per-sport Zod schemas arrive
// with the adapters.
export type EventDetails = Record<string, unknown>;
export type EventOutcome = Record<string, unknown>;

const newId = () => crypto.randomUUID();

export const sport = sqliteTable("sport", {
  // Stable slug: "football", "f1".
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const competition = sqliteTable(
  "competition",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    sportId: text("sport_id")
      .notNull()
      .references(() => sport.id),
    name: text("name").notNull(),
    // e.g. "2026-27" or "2026".
    season: text("season").notNull(),
    // ISO country code, or "INT" for international competitions.
    country: text("country"),
  },
  (t) => [index("competition_sport_id_idx").on(t.sportId)],
);

export const participant = sqliteTable(
  "participant",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    sportId: text("sport_id")
      .notNull()
      .references(() => sport.id),
    kind: text("kind", { enum: PARTICIPANT_KINDS }).notNull(),
    name: text("name").notNull(),
    shortName: text("short_name"),
    country: text("country"),
    // Crest or photo. We link to it; we do not host it.
    imageUrl: text("image_url"),
  },
  (t) => [index("participant_sport_id_idx").on(t.sportId)],
);

export const event = sqliteTable(
  "event",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    competitionId: text("competition_id")
      .notNull()
      .references(() => competition.id),
    startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
    // False when the provider says the time is still to be confirmed.
    timeConfirmed: integer("time_confirmed", { mode: "boolean" })
      .notNull()
      .default(true),
    status: text("status", { enum: EVENT_STATUSES })
      .notNull()
      .default("scheduled"),
    // "Matchday 12", "Quarter-final", "Monaco GP".
    round: text("round"),
    venue: text("venue"),
    details: text("details", { mode: "json" })
      .$type<EventDetails>()
      .notNull()
      .$defaultFn(() => ({})),
  },
  (t) => [
    index("event_competition_starts_at_idx").on(t.competitionId, t.startsAt),
    index("event_starts_at_idx").on(t.startsAt),
  ],
);

export const eventParticipant = sqliteTable(
  "event_participant",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => participant.id),
    role: text("role", { enum: PARTICIPANT_ROLES }).notNull(),
    // Per-participant result (score, finishing position, time).
    outcome: text("outcome", { mode: "json" }).$type<EventOutcome>(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.participantId] }),
    // Lists a participant's events, e.g. for a team calendar feed.
    index("event_participant_participant_id_idx").on(t.participantId),
  ],
);

export type Sport = typeof sport.$inferSelect;
export type Competition = typeof competition.$inferSelect;
export type Participant = typeof participant.$inferSelect;
export type Event = typeof event.$inferSelect;
export type EventParticipant = typeof eventParticipant.$inferSelect;
