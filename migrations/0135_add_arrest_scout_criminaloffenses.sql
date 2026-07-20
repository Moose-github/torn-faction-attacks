ALTER TABLE arrest_scout_results
  ADD COLUMN current_criminaloffenses INTEGER;

ALTER TABLE arrest_scout_results
  ADD COLUMN historical_criminaloffenses INTEGER;

ALTER TABLE arrest_scout_results
  ADD COLUMN criminaloffenses_delta INTEGER;

ALTER TABLE arrest_scout_results
  ADD COLUMN current_criminaloffenses_timestamp INTEGER;

ALTER TABLE arrest_scout_results
  ADD COLUMN historical_criminaloffenses_timestamp INTEGER;
