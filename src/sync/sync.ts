import { and, eq } from "drizzle-orm";

import { AdapterError } from "../adapters/errors";
import type {
  NormalizedCompetition,
  NormalizedEvent,
  NormalizedParticipant,
  NormalizedStanding,
  SportAdapter,
} from "../adapters/types";
import type { Db } from "../db";
import {
  competition,
  event,
  eventParticipant,
  externalRef,
  participant,
  sport,
  standing,
  type ExternalEntityType,
} from "../db/schema";

// Copies what an adapter fetches into our database. This is the only place
// that talks to both a provider and the database (see CLAUDE.md, architecture
// rules). It never deletes events or competitions: a provider that stops
// listing a match does not make it disappear from our history.

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const SPORT_NAMES: Record<string, string> = {
  football: "Football",
  f1: "Formula 1",
};

export type Counts = { created: number; updated: number };

export type SyncResult = {
  competitions: Counts;
  participants: Counts;
  events: Counts;
  // Rows written. Standings are replaced on every run, so there is no "updated".
  standings: number;
  // Competitions that failed. The others were saved anyway.
  errors: { competition: string; error: unknown }[];
};

type SyncOptions = {
  // Used as the "updated at" of standings. Injected for tests.
  now?: Date;
  log?: (message: string) => void;
};

const emptyCounts = (): Counts => ({ created: 0, updated: 0 });

function addCounts(into: Counts, from: Counts) {
  into.created += from.created;
  into.updated += from.updated;
}

/**
 * Runs one adapter against the database. Each competition is saved in its own
 * transaction, so one that fails (a bad provider response, a constraint) leaves
 * no half-written data and does not stop the others.
 */
export async function syncAdapter(
  db: Db,
  adapter: SportAdapter,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const now = options.now ?? new Date();
  const result: SyncResult = {
    competitions: emptyCounts(),
    participants: emptyCounts(),
    events: emptyCounts(),
    standings: 0,
    errors: [],
  };

  const competitions = await adapter.fetchCompetitions();
  await ensureSports(db, competitions);

  for (const comp of competitions) {
    try {
      // Network first, so the transaction stays short.
      const events = await adapter.fetchEvents(comp.externalId);
      const standings = await adapter.fetchStandings(comp.externalId);

      const counts = await db.transaction((tx) =>
        saveCompetition(tx, adapter.provider, comp, events, standings, now),
      );

      addCounts(result.competitions, counts.competitions);
      addCounts(result.participants, counts.participants);
      addCounts(result.events, counts.events);
      result.standings += counts.standings;
      options.log?.(
        `${comp.externalId}: ${events.length} events (${counts.events.created} new), ${counts.standings} standing rows`,
      );
    } catch (error) {
      result.errors.push({ competition: comp.externalId, error });
      options.log?.(`${comp.externalId}: failed, nothing was saved for it`);
    }
  }

  return result;
}

async function ensureSports(db: Db, competitions: NormalizedCompetition[]) {
  for (const sportId of new Set(competitions.map((c) => c.sportId))) {
    const name = SPORT_NAMES[sportId];
    if (!name) {
      throw new AdapterError(
        `sync: unknown sport "${sportId}"; add it to SPORT_NAMES in src/sync/sync.ts`,
      );
    }
    await db.insert(sport).values({ id: sportId, name }).onConflictDoNothing();
  }
}

async function saveCompetition(
  tx: Tx,
  provider: string,
  comp: NormalizedCompetition,
  events: NormalizedEvent[],
  standings: NormalizedStanding[],
  now: Date,
) {
  const counts = {
    competitions: emptyCounts(),
    participants: emptyCounts(),
    events: emptyCounts(),
    standings: 0,
  };

  const competitionId = await upsert(
    tx,
    provider,
    "competition",
    comp.externalId,
    counts.competitions,
    (id) =>
      tx.insert(competition).values({
        id,
        sportId: comp.sportId,
        name: comp.name,
        season: comp.season,
        country: comp.country,
      }),
    (id) =>
      tx
        .update(competition)
        .set({ name: comp.name, season: comp.season, country: comp.country })
        .where(eq(competition.id, id)),
  );

  // A team is saved once per competition, even if it plays 40 matches.
  const participantIds = new Map<string, string>();
  const participantId = async (p: NormalizedParticipant) => {
    const known = participantIds.get(p.externalId);
    if (known) return known;
    const id = await upsertParticipant(
      tx,
      provider,
      comp.sportId,
      p,
      counts.participants,
    );
    participantIds.set(p.externalId, id);
    return id;
  };

  for (const e of events) {
    const eventId = await upsert(
      tx,
      provider,
      "event",
      e.externalId,
      counts.events,
      (id) => tx.insert(event).values({ id, competitionId, ...eventValues(e) }),
      (id) =>
        tx
          .update(event)
          .set({ competitionId, ...eventValues(e) })
          .where(eq(event.id, id)),
    );

    // Sides can change (a swapped home/away, a corrected score), so they are
    // rewritten rather than patched.
    await tx
      .delete(eventParticipant)
      .where(eq(eventParticipant.eventId, eventId));
    for (const side of e.participants) {
      await tx.insert(eventParticipant).values({
        eventId,
        participantId: await participantId(side.participant),
        role: side.role,
        outcome: side.outcome,
      });
    }
  }

  // Standings are a snapshot: replace the whole competition, so a team that
  // left the table does not linger.
  await tx.delete(standing).where(eq(standing.competitionId, competitionId));
  for (const row of standings) {
    await tx.insert(standing).values({
      competitionId,
      participantId: await participantId(row.participant),
      tableName: row.table,
      rank: row.rank,
      points: row.points,
      stats: row.stats,
      updatedAt: now,
    });
    counts.standings += 1;
  }

  return counts;
}

function eventValues(e: NormalizedEvent) {
  return {
    startsAt: e.startsAt,
    timeConfirmed: e.timeConfirmed,
    status: e.status,
    round: e.round,
    venue: e.venue,
    details: e.details,
  };
}

function upsertParticipant(
  tx: Tx,
  provider: string,
  sportId: string,
  p: NormalizedParticipant,
  counts: Counts,
) {
  const values = {
    kind: p.kind,
    name: p.name,
    shortName: p.shortName,
    imageUrl: p.imageUrl,
  };
  return upsert(
    tx,
    provider,
    "participant",
    p.externalId,
    counts,
    (id) => tx.insert(participant).values({ id, sportId, ...values }),
    (id) => tx.update(participant).set(values).where(eq(participant.id, id)),
  );
}

/**
 * Finds our entity for a provider ID and updates it, or creates it and records
 * the ID in `external_ref`. This is what makes a second run update instead of
 * duplicate, and what keeps our own IDs stable (calendar feeds depend on that).
 */
async function upsert(
  tx: Tx,
  provider: string,
  entityType: ExternalEntityType,
  externalId: string,
  counts: Counts,
  insertRow: (id: string) => PromiseLike<unknown>,
  updateRow: (id: string) => PromiseLike<unknown>,
): Promise<string> {
  const [existing] = await tx
    .select({ entityId: externalRef.entityId })
    .from(externalRef)
    .where(
      and(
        eq(externalRef.provider, provider),
        eq(externalRef.entityType, entityType),
        eq(externalRef.externalId, externalId),
      ),
    );

  if (existing) {
    await updateRow(existing.entityId);
    counts.updated += 1;
    return existing.entityId;
  }

  const id = crypto.randomUUID();
  await insertRow(id);
  await tx
    .insert(externalRef)
    .values({ entityType, entityId: id, provider, externalId });
  counts.created += 1;
  return id;
}
