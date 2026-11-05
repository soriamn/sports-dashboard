import { z } from "zod";

// Zod schemas for the parts of ESPN's responses we use. Unknown fields are
// ignored, so ESPN adding fields does not break us; a missing or malformed field
// we depend on does, with an error naming it (see `parseResponse`).
//
// ESPN sends numbers as text in places ("score": "2"), so they are converted
// explicitly.

const wholeNumberText = z
  .string()
  .regex(/^\d+$/, "expected a whole number written as text")
  .transform(Number);

const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "expected a date")
  // Examples: "2026-11-06T20:00Z" (no seconds), parsed as UTC.
  .transform((s) => new Date(s));

const team = z.object({
  id: z.string(),
  displayName: z.string(),
  abbreviation: z.string().optional(),
  logo: z.string().optional(),
});

const competitor = z.object({
  homeAway: z.enum(["home", "away"]),
  score: wholeNumberText,
  shootoutScore: z.number().int().nonnegative().optional(),
  team,
});

const competition = z.object({
  // False when the kickoff time is still to be confirmed.
  timeValid: z.boolean(),
  venue: z.object({ fullName: z.string() }).optional(),
  competitors: z.array(competitor).length(2),
});

const event = z.object({
  id: z.string(),
  date: isoDate,
  season: z.object({ year: z.number().int(), slug: z.string() }),
  status: z.object({
    type: z.object({
      name: z.string(),
      // pre = not started, in = in progress, post = over.
      state: z.enum(["pre", "in", "post"]),
    }),
  }),
  competitions: z.array(competition).min(1),
});

export const scoreboardSchema = z.object({
  leagues: z
    .array(z.object({ season: z.object({ year: z.number().int() }) }))
    .min(1),
  events: z.array(event),
});

const standingsTeam = z.object({
  id: z.string(),
  displayName: z.string(),
  abbreviation: z.string().optional(),
  logos: z.array(z.object({ href: z.string() })).optional(),
});

const standingsEntry = z.object({
  team: standingsTeam,
  stats: z.array(z.object({ name: z.string(), value: z.number().optional() })),
});

export const standingsSchema = z.object({
  season: z.object({ year: z.number().int() }),
  children: z
    .array(
      z.object({
        name: z.string(),
        standings: z.object({ entries: z.array(standingsEntry) }),
      }),
    )
    .min(1),
});

export type EspnEvent = z.infer<typeof event>;
export type EspnScoreboard = z.infer<typeof scoreboardSchema>;
export type EspnStandings = z.infer<typeof standingsSchema>;
