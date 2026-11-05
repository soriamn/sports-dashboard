// The leagues we follow. ESPN identifies a league by a slug such as "eng.1".

export type SeasonFormat =
  // The season spans two calendar years: 2026-27.
  | "split"
  // The season is one calendar year: 2026.
  | "calendar";

export type LeagueConfig = {
  slug: string;
  name: string;
  country: string;
  seasonFormat: SeasonFormat;
};

export const LEAGUES: readonly LeagueConfig[] = [
  {
    slug: "arg.1",
    name: "Liga Profesional",
    country: "AR",
    seasonFormat: "calendar",
  },
  {
    slug: "eng.1",
    name: "Premier League",
    country: "GB",
    seasonFormat: "split",
  },
  { slug: "esp.1", name: "La Liga", country: "ES", seasonFormat: "split" },
  { slug: "ita.1", name: "Serie A", country: "IT", seasonFormat: "split" },
];
