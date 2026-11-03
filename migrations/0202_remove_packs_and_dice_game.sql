-- These features were retired before this migration; no active routes use them.
DROP TABLE IF EXISTS pack_reward_entries;
DROP TABLE IF EXISTS pack_definitions;
DROP TABLE IF EXISTS dice_game_losses;

DELETE FROM item_group_items WHERE group_id = 'travel_pack_items';
DELETE FROM item_groups WHERE id = 'travel_pack_items';
UPDATE item_groups
SET description = 'Energy can items used by Trade Scout presets.'
WHERE id = 'energy_cans'
  AND description = 'Energy can items used by Trade Scout presets and pack rewards.';
