import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// Schema for the common data model described in docs/DATA_MODEL.md.
// Only the tables needed so far exist; NewsItem and CompetitionEntry are added
// with the stories that need them.
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
export const EXTERNAL_ENTITY_TYPES = [
  "competition",
  "participant",
  "event",
] as const;

export type ParticipantKind = (typeof PARTICIPANT_KINDS)[number];
export type EventStatus = (typeof EVENT_STATUSES)[number];
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];
export type ExternalEntityType = (typeof EXTERNAL_ENTITY_TYPES)[number];

// Sport-specific JSON. Typed loosely for now; per-sport Zod schemas arrive
// with the adapters.
export type EventDetails = Record<string, unknown>;
export type EventOutcome = Record<string, unknown>;
export type StandingStats = Record<string, unknown>;

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

export const standing = sqliteTable(
  "standing",
  {
    competitionId: text("competition_id")
      .notNull()
      .references(() => competition.id),
    participantId: text("participant_id")
      .notNull()
      .references(() => participant.id),
    // Which table of the competition the row belongs to: "league", "Group A",
    // "drivers", "constructors". Named table_name because "table" is reserved.
    tableName: text("table_name").notNull(),
    rank: integer("rank").notNull(),
    // Not an integer column on purpose: some sports award half points.
    points: real("points").notNull(),
    // Sport-specific numbers (played/won/drawn/lost/goals for football).
    stats: text("stats", { mode: "json" })
      .$type<StandingStats>()
      .notNull()
      .$defaultFn(() => ({})),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.competitionId, t.participantId, t.tableName] }),
    // Lists the tables a participant appears in.
    index("standing_participant_id_idx").on(t.participantId),
  ],
);

// Maps our entities to a provider's IDs, so a sync can update what it already
// stored instead of creating duplicates. The provider ID lives only here, never
// in the main tables. entity_id points at a different table depending on
// entity_type, so SQLite cannot enforce it with a foreign key: whoever deletes
// an entity must delete its refs too (the seed does).
export const externalRef = sqliteTable(
  "external_ref",
  {
    entityType: text("entity_type", { enum: EXTERNAL_ENTITY_TYPES }).notNull(),
    entityId: text("entity_id").notNull(),
    // e.g. "espn", "jolpica".
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
  },
  (t) => [
    // One of our entities per provider ID. This is what the sync looks up.
    primaryKey({ columns: [t.provider, t.entityType, t.externalId] }),
    // Finds the refs of one of our entities.
    index("external_ref_entity_idx").on(t.entityType, t.entityId),
  ],
);

export type Sport = typeof sport.$inferSelect;
export type Competition = typeof competition.$inferSelect;
export type Participant = typeof participant.$inferSelect;
export type Event = typeof event.$inferSelect;
export type EventParticipant = typeof eventParticipant.$inferSelect;
export type Standing = typeof standing.$inferSelect;
export type ExternalRef = typeof externalRef.$inferSelect;
