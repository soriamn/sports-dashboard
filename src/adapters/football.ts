import { z } from "zod";

// Football-specific JSON stored inside the common model (docs/DATA_MODEL.md,
// "Sport-specific details"). Shared by every football adapter.

const count = z.number().int().nonnegative();

export const footballEventDetailsSchema = z.object({
  // True when the match went to extra time (and possibly penalties).
  extraTime: z.boolean(),
  halftimeScore: z.object({ home: count, away: count }).optional(),
});
export type FootballEventDetails = z.infer<typeof footballEventDetailsSchema>;

// Per participant. `shootoutScore` is set only when a penalty shootout decided
// the match.
export const footballOutcomeSchema = z.object({
  score: count.nullable(),
  shootoutScore: count.optional(),
});
export type FootballOutcome = z.infer<typeof footballOutcomeSchema>;

export const footballStandingSchema = z.object({
  played: count,
  won: count,
  drawn: count,
  lost: count,
  goalsFor: count,
  goalsAgainst: count,
});
export type FootballStanding = z.infer<typeof footballStandingSchema>;
