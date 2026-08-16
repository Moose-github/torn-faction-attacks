INSERT INTO torn_items (
  torn_item_id,
  name,
  image_url,
  image_url_large,
  category,
  updated_at
)
VALUES
  (530, 'Can of Munster', 'https://www.torn.com/images/items/530/medium@2x.png', 'https://www.torn.com/images/items/530/large@2x.png', 'Energy Drink', unixepoch()),
  (532, 'Can of Red Cow', 'https://www.torn.com/images/items/532/medium@2x.png', 'https://www.torn.com/images/items/532/large@2x.png', 'Energy Drink', unixepoch()),
  (533, 'Can of Taurine Elite', 'https://www.torn.com/images/items/533/medium@2x.png', 'https://www.torn.com/images/items/533/large@2x.png', 'Energy Drink', unixepoch()),
  (553, 'Can of Santa Shooters', 'https://www.torn.com/images/items/553/medium@2x.png', 'https://www.torn.com/images/items/553/large@2x.png', 'Energy Drink', unixepoch()),
  (554, 'Can of Rockstar Rudolph', 'https://www.torn.com/images/items/554/medium@2x.png', 'https://www.torn.com/images/items/554/large@2x.png', 'Energy Drink', unixepoch()),
  (555, 'Can of X-MASS', 'https://www.torn.com/images/items/555/medium@2x.png', 'https://www.torn.com/images/items/555/large@2x.png', 'Energy Drink', unixepoch()),
  (985, 'Can of Goose Juice', 'https://www.torn.com/images/items/985/medium@2x.png', 'https://www.torn.com/images/items/985/large@2x.png', 'Energy Drink', unixepoch()),
  (986, 'Can of Damp Valley', 'https://www.torn.com/images/items/986/medium@2x.png', 'https://www.torn.com/images/items/986/large@2x.png', 'Energy Drink', unixepoch()),
  (987, 'Can of Crocozade', 'https://www.torn.com/images/items/987/medium@2x.png', 'https://www.torn.com/images/items/987/large@2x.png', 'Energy Drink', unixepoch()),
  (258, 'Jaguar Plushie', 'https://www.torn.com/images/items/258/medium@2x.png', 'https://www.torn.com/images/items/258/large@2x.png', 'Plushie', unixepoch()),
  (260, 'Dahlia', 'https://www.torn.com/images/items/260/medium@2x.png', 'https://www.torn.com/images/items/260/large@2x.png', 'Flower', unixepoch()),
  (261, 'Wolverine Plushie', 'https://www.torn.com/images/items/261/medium@2x.png', 'https://www.torn.com/images/items/261/large@2x.png', 'Plushie', unixepoch()),
  (263, 'Crocus', 'https://www.torn.com/images/items/263/medium@2x.png', 'https://www.torn.com/images/items/263/large@2x.png', 'Flower', unixepoch()),
  (264, 'Orchid', 'https://www.torn.com/images/items/264/medium@2x.png', 'https://www.torn.com/images/items/264/large@2x.png', 'Flower', unixepoch()),
  (266, 'Nessie Plushie', 'https://www.torn.com/images/items/266/medium@2x.png', 'https://www.torn.com/images/items/266/large@2x.png', 'Plushie', unixepoch()),
  (268, 'Red Fox Plushie', 'https://www.torn.com/images/items/268/medium@2x.png', 'https://www.torn.com/images/items/268/large@2x.png', 'Plushie', unixepoch()),
  (269, 'Monkey Plushie', 'https://www.torn.com/images/items/269/medium@2x.png', 'https://www.torn.com/images/items/269/large@2x.png', 'Plushie', unixepoch()),
  (273, 'Chamois Plushie', 'https://www.torn.com/images/items/273/medium@2x.png', 'https://www.torn.com/images/items/273/large@2x.png', 'Plushie', unixepoch()),
  (274, 'Panda Plushie', 'https://www.torn.com/images/items/274/medium@2x.png', 'https://www.torn.com/images/items/274/large@2x.png', 'Plushie', unixepoch())
ON CONFLICT(torn_item_id) DO UPDATE SET
  name = excluded.name,
  image_url = excluded.image_url,
  image_url_large = excluded.image_url_large,
  category = excluded.category,
  updated_at = excluded.updated_at;

INSERT OR IGNORE INTO item_groups (
  id,
  name,
  description
)
VALUES (
  'travel_pack_items',
  'Travel pack items',
  'Travel flowers and plushies used by the faction travel pack.'
);

INSERT OR IGNORE INTO item_group_items (
  group_id,
  torn_item_id,
  display_order
)
VALUES
  ('travel_pack_items', 258, 0),
  ('travel_pack_items', 260, 1),
  ('travel_pack_items', 261, 2),
  ('travel_pack_items', 263, 3),
  ('travel_pack_items', 264, 4),
  ('travel_pack_items', 266, 5),
  ('travel_pack_items', 268, 6),
  ('travel_pack_items', 269, 7),
  ('travel_pack_items', 273, 8),
  ('travel_pack_items', 274, 9);

INSERT OR IGNORE INTO pack_definitions (
  id,
  name,
  description
)
VALUES (
  'faction_travel_pack',
  'Faction travel pack',
  'Rainbow Six Siege-style reveal pack using travel plushies and flowers.'
);

INSERT INTO pack_reward_entries (
  id,
  pack_id,
  torn_item_id,
  rarity,
  weight,
  display_order,
  updated_at
)
VALUES
  ('faction_travel_pack:258', 'faction_travel_pack', 258, 'standard', 18, 0, unixepoch()),
  ('faction_travel_pack:260', 'faction_travel_pack', 260, 'standard', 18, 1, unixepoch()),
  ('faction_travel_pack:261', 'faction_travel_pack', 261, 'standard', 16, 2, unixepoch()),
  ('faction_travel_pack:263', 'faction_travel_pack', 263, 'select', 12, 3, unixepoch()),
  ('faction_travel_pack:264', 'faction_travel_pack', 264, 'select', 12, 4, unixepoch()),
  ('faction_travel_pack:266', 'faction_travel_pack', 266, 'elite', 8, 5, unixepoch()),
  ('faction_travel_pack:268', 'faction_travel_pack', 268, 'elite', 6, 6, unixepoch()),
  ('faction_travel_pack:269', 'faction_travel_pack', 269, 'elite', 5, 7, unixepoch()),
  ('faction_travel_pack:273', 'faction_travel_pack', 273, 'legendary', 3, 8, unixepoch()),
  ('faction_travel_pack:274', 'faction_travel_pack', 274, 'legendary', 2, 9, unixepoch())
ON CONFLICT(id) DO UPDATE SET
  rarity = excluded.rarity,
  weight = excluded.weight,
  enabled = 1,
  display_order = excluded.display_order,
  updated_at = excluded.updated_at;
