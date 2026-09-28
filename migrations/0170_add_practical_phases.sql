ALTER TABLE wars ADD COLUMN practical_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE wars ADD COLUMN practical_rebuild_pending INTEGER NOT NULL DEFAULT 0;

CREATE TABLE war_practical_phases (
  id TEXT PRIMARY KEY,
  war_id INTEGER NOT NULL REFERENCES wars(id) ON DELETE CASCADE,
  target REAL CHECK (target IS NULL OR target > 0),
  scheduled_start INTEGER NOT NULL,
  start_time INTEGER,
  finish_time INTEGER,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'active', 'completed', 'skipped', 'cancelled')),
  reason TEXT,
  removed_at INTEGER,
  effects_pending INTEGER NOT NULL DEFAULT 0,
  CHECK (finish_time IS NULL OR (start_time IS NOT NULL AND finish_time >= start_time))
);
CREATE INDEX idx_practical_phases_war ON war_practical_phases(war_id, start_time);
CREATE UNIQUE INDEX idx_practical_phase_active ON war_practical_phases(war_id) WHERE status = 'active' AND removed_at IS NULL;
CREATE UNIQUE INDEX idx_practical_phase_scheduled ON war_practical_phases(war_id) WHERE status = 'scheduled' AND removed_at IS NULL;

CREATE TABLE war_practical_phase_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  war_id INTEGER NOT NULL REFERENCES wars(id) ON DELETE CASCADE,
  changed_at INTEGER NOT NULL,
  actor_id INTEGER,
  action TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL
);
CREATE INDEX idx_practical_phase_audit_war ON war_practical_phase_audit(war_id, id);

INSERT INTO war_practical_phases (id, war_id, target, scheduled_start, start_time, finish_time, status, reason)
SELECT 'initial-' || id, id, NULLIF(faction_respect_limit, 0), practical_start_time,
  CASE WHEN status = 'scheduled' AND COALESCE(practical_finish_time, official_end_time) IS NULL THEN NULL ELSE practical_start_time END,
  COALESCE(practical_finish_time, official_end_time),
  CASE WHEN practical_finish_time IS NOT NULL OR official_end_time IS NOT NULL THEN 'completed'
       WHEN status = 'scheduled' THEN 'scheduled' ELSE 'active' END, 'legacy'
FROM wars WHERE war_type = 'termed';

CREATE TRIGGER war_practical_phase_insert AFTER INSERT ON wars WHEN NEW.war_type = 'termed'
BEGIN
  INSERT INTO war_practical_phases (id, war_id, target, scheduled_start, start_time, finish_time, status)
  VALUES ('initial-' || NEW.id, NEW.id, NULLIF(NEW.faction_respect_limit, 0), NEW.practical_start_time,
    CASE WHEN NEW.status = 'scheduled' AND COALESCE(NEW.practical_finish_time, NEW.official_end_time) IS NULL THEN NULL ELSE NEW.practical_start_time END,
    COALESCE(NEW.practical_finish_time, NEW.official_end_time),
    CASE WHEN NEW.practical_finish_time IS NOT NULL OR NEW.official_end_time IS NOT NULL THEN 'completed'
         WHEN NEW.status = 'scheduled' THEN 'scheduled' ELSE 'active' END);
END;

CREATE TRIGGER war_practical_phase_convert AFTER UPDATE OF war_type ON wars
WHEN NEW.war_type = 'termed' AND COALESCE(OLD.war_type, 'real') != 'termed' AND NOT EXISTS (SELECT 1 FROM war_practical_phases WHERE war_id = NEW.id)
BEGIN
  INSERT INTO war_practical_phases (id, war_id, target, scheduled_start, start_time, finish_time, status)
  VALUES ('initial-' || NEW.id, NEW.id, NULLIF(NEW.faction_respect_limit, 0), NEW.practical_start_time,
    CASE WHEN NEW.status = 'scheduled' AND COALESCE(NEW.practical_finish_time, NEW.official_end_time) IS NULL THEN NULL ELSE NEW.practical_start_time END,
    COALESCE(NEW.practical_finish_time, NEW.official_end_time),
    CASE WHEN NEW.practical_finish_time IS NOT NULL OR NEW.official_end_time IS NOT NULL THEN 'completed'
         WHEN NEW.status = 'scheduled' THEN 'scheduled' ELSE 'active' END);
END;
