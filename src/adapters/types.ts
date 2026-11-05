import type { EventDetails, EventOutcome } from "../db/schema";
import type {
  EventStatus,
  ParticipantKind,
  ParticipantRole,
} from "../db/schema";

// The normalized shapes every adapter returns (see docs/DATA_MODEL.md).
//
// Adapters do not touch the database and do not know our internal IDs, so every
// entity is identified by the provider's own ID (`externalId`). The sync maps
// those to internal IDs through `ExternalRef`.

export type NormalizedCompetition = {
  // Provider ID of the competition in a specific season, e.g. "eng.1:2026".
  externalId: string;
  sportId: string;
  name: string;
  // e.g. "2026-27" or "2026".
  season: string;
  // ISO country code, or "INT" for international competitions.
  country: string | null;
};

export type NormalizedParticipant = {
  externalId: string;
  kind: ParticipantKind;
  name: string;
  shortName: string | null;
  imageUrl: string | null;
};

export type NormalizedEvent = {
  externalId: string;
  competitionExternalId: string;
  startsAt: Date;
  timeConfirmed: boolean;
  status: EventStatus;
  round: string | null;
  venue: string | null;
  details: EventDetails;
  participants: {
    participant: NormalizedParticipant;
    role: ParticipantRole;
    outcome: EventOutcome | null;
  }[];
};

export type NormalizedStanding = {
  competitionExternalId: string;
  participant: NormalizedParticipant;
  // Which table of the competition this row belongs to: "league", "Group A".
  table: string;
  rank: number;
  points: number;
  // Sport-specific numbers, validated per sport.
  stats: Record<string, unknown>;
};

export interface SportAdapter {
  provider: string;
  fetchCompetitions(): Promise<NormalizedCompetition[]>;
  fetchEvents(competitionExternalId: string): Promise<NormalizedEvent[]>;
  fetchStandings(competitionExternalId: string): Promise<NormalizedStanding[]>;
}
