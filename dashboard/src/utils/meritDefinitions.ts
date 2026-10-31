export type MeritDefinition = { key: string; name: string; group: string; multiplier: number | null; unit: string; multiplier2: number | null; unit2: string; description: string };
// Effects transcribed from the supplied merit element; API catalog names are matched at import.
export const MERIT_DEFINITIONS: MeritDefinition[] = [
  {
    "key": "nerve-bar",
    "name": "Nerve Bar",
    "group": "General",
    "multiplier": 1.0,
    "unit": "",
    "multiplier2": null,
    "unit2": "",
    "description": "Increases maximum nerve bar by"
  },
  {
    "key": "critical-hit-rate",
    "name": "Critical Hit Rate",
    "group": "General",
    "multiplier": 0.5,
    "unit": "%",
    "multiplier2": null,
    "unit2": "",
    "description": "Increases critical hit rate by"
  },
  {
    "key": "life-points",
    "name": "Life Points",
    "group": "General",
    "multiplier": 5.0,
    "unit": "%",
    "multiplier2": null,
    "unit2": "",
    "description": "Constantly modifies life by"
  },
  {
    "key": "crime-xp",
    "name": "Crime XP",
    "group": "General",
    "multiplier": null,
    "unit": "",
    "multiplier2": null,
    "unit2": "",
    "description": ""
  },
  {
    "key": "education-length",
    "name": "Education Length",
    "group": "General",
    "multiplier": 2.0,
    "unit": "%",
    "multiplier2": null,
    "unit2": "",
    "description": "Decreases education course length by"
  },
  {
    "key": "awareness",
    "name": "Awareness",
    "group": "General",
    "multiplier": 20.0,
    "unit": "%",
    "multiplier2": null,
    "unit2": "",
    "description": "Increases frequency of items appearing in the city by"
  },
  {
    "key": "bank-interest",
    "name": "Bank Interest",
    "group": "General",
    "multiplier": 5.0,
    "unit": "%",
    "multiplier2": null,
    "unit2": "",
    "description": "Increases bank interest by"
  },
  {
    "key": "masterful-looting",
    "name": "Masterful Looting",
    "group": "General",
    "multiplier": 5.0,
    "unit": "%",
    "multiplier2": null,
    "unit2": "",
    "description": "Increases money gained from mugging by"
  },
  {
    "key": "stealth",
    "name": "Stealth",
    "group": "General",
    "multiplier": 0.2,
    "unit": "",
    "multiplier2": null,
    "unit2": "",
    "description": "Increases stealth during outgoing attacks by"
  },
  {
    "key": "hospitalizing",
    "name": "Hospitalizing",
    "group": "General",
    "multiplier": 5.0,
    "unit": "%",
    "multiplier2": null,
    "unit2": "",
    "description": "Increases hospitalization time by"
  },
  {
    "key": "addiction-mitigation",
    "name": "Addiction Mitigation",
    "group": "General",
    "multiplier": 2.0,
    "unit": "%",
    "multiplier2": null,
    "unit2": "",
    "description": "Reduces the negative effects of addiction by"
  },
  {
    "key": "employee-effectiveness",
    "name": "Employee Effectiveness",
    "group": "General",
    "multiplier": 1.0,
    "unit": "",
    "multiplier2": null,
    "unit2": "",
    "description": "Increases employee effectiveness by"
  },
  {
    "key": "brawn",
    "name": "Brawn",
    "group": "Combat",
    "multiplier": 3.0,
    "unit": "%",
    "multiplier2": null,
    "unit2": "",
    "description": "Passive bonus of"
  },
  {
    "key": "protection",
    "name": "Protection",
    "group": "Combat",
    "multiplier": 3.0,
    "unit": "%",
    "multiplier2": null,
    "unit2": "",
    "description": "Passive bonus of"
  },
  {
    "key": "sharpness",
    "name": "Sharpness",
    "group": "Combat",
    "multiplier": 3.0,
    "unit": "%",
    "multiplier2": null,
    "unit2": "",
    "description": "Passive bonus of"
  },
  {
    "key": "evasion",
    "name": "Evasion",
    "group": "Combat",
    "multiplier": 3.0,
    "unit": "%",
    "multiplier2": null,
    "unit2": "",
    "description": "Passive bonus of"
  },
  {
    "key": "heavy-artillery-mastery",
    "name": "Heavy Artillery Mastery",
    "group": "Weapons",
    "multiplier": 1.0,
    "unit": "%",
    "multiplier2": 0.2,
    "unit2": "",
    "description": "Increases damage and accuracy by"
  },
  {
    "key": "machine-gun-mastery",
    "name": "Machine Gun Mastery",
    "group": "Weapons",
    "multiplier": 1.0,
    "unit": "%",
    "multiplier2": 0.2,
    "unit2": "",
    "description": "Increases damage and accuracy by"
  },
  {
    "key": "rifle-mastery",
    "name": "Rifle Mastery",
    "group": "Weapons",
    "multiplier": 1.0,
    "unit": "%",
    "multiplier2": 0.2,
    "unit2": "",
    "description": "Increases damage and accuracy by"
  },
  {
    "key": "smg-mastery",
    "name": "SMG Mastery",
    "group": "Weapons",
    "multiplier": 1.0,
    "unit": "%",
    "multiplier2": 0.2,
    "unit2": "",
    "description": "Increases damage and accuracy by"
  },
  {
    "key": "shotgun-mastery",
    "name": "Shotgun Mastery",
    "group": "Weapons",
    "multiplier": 1.0,
    "unit": "%",
    "multiplier2": 0.2,
    "unit2": "",
    "description": "Increases damage and accuracy by"
  },
  {
    "key": "pistol-mastery",
    "name": "Pistol Mastery",
    "group": "Weapons",
    "multiplier": 1.0,
    "unit": "%",
    "multiplier2": 0.2,
    "unit2": "",
    "description": "Increases damage and accuracy by"
  },
  {
    "key": "club-mastery",
    "name": "Club Mastery",
    "group": "Weapons",
    "multiplier": 1.0,
    "unit": "%",
    "multiplier2": 0.2,
    "unit2": "",
    "description": "Increases damage and accuracy by"
  },
  {
    "key": "piercing-mastery",
    "name": "Piercing Mastery",
    "group": "Weapons",
    "multiplier": 1.0,
    "unit": "%",
    "multiplier2": 0.2,
    "unit2": "",
    "description": "Increases damage and accuracy by"
  },
  {
    "key": "slashing-mastery",
    "name": "Slashing Mastery",
    "group": "Weapons",
    "multiplier": 1.0,
    "unit": "%",
    "multiplier2": 0.2,
    "unit2": "",
    "description": "Increases damage and accuracy by"
  },
  {
    "key": "mechanical-mastery",
    "name": "Mechanical Mastery",
    "group": "Weapons",
    "multiplier": 1.0,
    "unit": "%",
    "multiplier2": 0.2,
    "unit2": "",
    "description": "Increases damage and accuracy by"
  },
  {
    "key": "temporary-mastery",
    "name": "Temporary Mastery",
    "group": "Weapons",
    "multiplier": 1.0,
    "unit": "%",
    "multiplier2": 0.2,
    "unit2": "",
    "description": "Increases damage and accuracy by"
  }
];
