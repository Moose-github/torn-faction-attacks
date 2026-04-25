export const SOURCE_NAME = "attacks";
export const API_URL = "https://api.torn.com/v2/faction/attacks";
export const RANKED_WARS_API_URL = "https://api.torn.com/v2/faction/rankedwars";
export const LIMIT = 100;
export const OVERLAP_SECONDS = 60;
export const WAR_TYPES = ["real", "termed", "other"] as const;

// Hardcoded for now to keep the reporting model focused on your faction.
export const HOME_FACTION_ID = 8803;

// Explicit allowlist so odd/unknown future result values do not get counted as wins.
export const POSITIVE_ATTACK_RESULTS = [
  "Hospitalized",
  "Mugged",
  "Attacked",
  "Arrested",
] as const;

export const POSITIVE_RESULTS_SQL = `'Hospitalized','Mugged','Attacked','Arrested'`;
