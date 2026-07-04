ALTER TABLE arrest_scout_results
  ADD COLUMN current_scammingskill INTEGER;

ALTER TABLE arrest_scout_results
  ADD COLUMN current_fraud INTEGER;

ALTER TABLE arrest_scout_results
  ADD COLUMN historical_fraud INTEGER;

ALTER TABLE arrest_scout_results
  ADD COLUMN fraud_delta INTEGER;

ALTER TABLE arrest_scout_results
  ADD COLUMN current_fraud_timestamp INTEGER;

ALTER TABLE arrest_scout_results
  ADD COLUMN current_scammingskill_timestamp INTEGER;

ALTER TABLE arrest_scout_results
  ADD COLUMN historical_fraud_timestamp INTEGER;

ALTER TABLE arrest_scout_results
  ADD COLUMN historical_scammingskill_timestamp INTEGER;

ALTER TABLE arrest_scout_future_targets
  ADD COLUMN last_fraud_delta INTEGER;
