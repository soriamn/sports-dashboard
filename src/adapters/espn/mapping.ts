import type { EventStatus } from "../../db/schema";
import { AdapterError } from "../errors";
import type { SeasonFormat } from "./leagues";

// Pure functions that translate ESPN's vocabulary into ours.

type StatusMapping = { status: EventStatus; extraTime: boolean };

// Status names seen in real responses (see docs/PROVIDER_SPIKE.md).
const KNOWN_STATUSES: Record<string, StatusMapping> = {
  STATUS_SCHEDULED: { status: "scheduled", extraTime: false },
  STATUS_FULL_TIME: { status: "finished", extraTime: false },
  STATUS_FINAL_AET: { status: "finished", extraTime: true },
  STATUS_FINAL_PEN: { status: "finished", extraTime: true },
  // An abandoned match is usually replayed, so we treat it as postponed.
  STATUS_ABANDONED: { status: "postponed", extraTime: false },
};

/**
 * Maps ESPN's status to ours. Names we have not seen fail loudly, except while a
 * match is in progress (`state: "in"`), where the exact name does not matter.
 * Guessing would risk showing a postponed match as scheduled.
 */
export function mapStatus(
  name: string,
  state: "pre" | "in" | "post",
  context: string,
): StatusMapping {
  const known = KNOWN_STATUSES[name];
  if (known) return known;
  if (state === "in") return { status: "live", extraTime: false };
  throw new AdapterError(
    `${context}: unknown match status "${name}" (state "${state}"); add it to KNOWN_STATUSES in mapping.ts`,
  );
}

/** "2026-27" for a split season, "2026" for a calendar one. */
export function seasonLabel(year: number, format: SeasonFormat): string {
  if (format === "calendar") return String(year);
  return `${year}-${String(year + 1).slice(-2)}`;
}

/** The calendar years that contain matches of a season. */
export function seasonCalendarYears(
  year: number,
  format: SeasonFormat,
): number[] {
  return format === "calendar" ? [year] : [year, year + 1];
}

const competitionIdPattern = /^([a-z]+\.\d+):(\d{4})$/;

export function competitionExternalId(slug: string, year: number): string {
  return `${slug}:${year}`;
}

export function parseCompetitionExternalId(
  id: string,
): { slug: string; year: number } | null {
  const match = competitionIdPattern.exec(id);
  return match ? { slug: match[1], year: Number(match[2]) } : null;
}

/**
 * Turns ESPN's season slug into a round label, for calendar-year leagues only.
 * ESPN gives no matchday, but the Argentine league puts the tournament and the
 * playoff stage in the slug:
 *   "torneo-clausura"               -> "Clausura"
 *   "apertura---quarterfinals"      -> "Apertura - Quarterfinals"
 *   "apertura---round-of-16"        -> "Apertura - Round of 16"
 * Split-season leagues have nothing to show, so the round is null.
 */
export function roundFromSeasonSlug(
  slug: string,
  format: SeasonFormat,
): string | null {
  if (format !== "calendar") return null;
  return slug
    .split("---")
    .map((part) => {
      const words = part.replace(/^torneo-/, "").replaceAll("-", " ");
      return words.charAt(0).toUpperCase() + words.slice(1);
    })
    .join(" - ");
}
