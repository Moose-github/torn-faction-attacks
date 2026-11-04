-- Older syncs only queued failed requests, leaving copies beyond the per-run
-- limit unqueued. Seed that backlog before syncs rely on the queue for due work.
-- Match armory.ts DETAIL_JOIN so incompatible cached details are fetched too.
INSERT INTO armory_detail_fetch_state (uid)
SELECT i.uid
FROM faction_armory_inventory i
LEFT JOIN armory_weapon_details d ON d.uid = i.uid
  AND d.model_id = i.model_id AND d.payload_version = 1
  AND json_extract(d.details_json, '$.type') = CASE WHEN i.category = 'armor' THEN 'Armor' ELSE 'Weapon' END
WHERE d.uid IS NULL
ON CONFLICT(uid) DO NOTHING;
