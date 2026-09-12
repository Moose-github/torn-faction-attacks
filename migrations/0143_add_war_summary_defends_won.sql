ALTER TABLE war_summary
  ADD COLUMN defends_won INTEGER NOT NULL DEFAULT 0;

UPDATE war_summary
SET defends_won = (
  SELECT COALESCE(SUM(wms.defends_won), 0)
  FROM war_member_stats wms
  WHERE wms.war_id = war_summary.war_id
);
