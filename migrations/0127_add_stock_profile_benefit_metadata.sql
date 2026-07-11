ALTER TABLE stock_profiles ADD COLUMN benefit_key TEXT;
ALTER TABLE stock_profiles ADD COLUMN benefit_label TEXT;
ALTER TABLE stock_profiles ADD COLUMN benefit_market_type TEXT;
ALTER TABLE stock_profiles ADD COLUMN benefit_torn_item_id INTEGER;
ALTER TABLE stock_profiles ADD COLUMN benefit_quantity REAL;

UPDATE stock_profiles
SET
  benefit_key = CASE json_extract(benefit_json, '$.description')
    WHEN '1x Lawyer''s Business Card' THEN 'item:lawyer_s_business_card'
    WHEN '1x Box of Medical Supplies' THEN 'item:box_of_medical_supplies'
    WHEN '1x Feathery Hotel Coupon' THEN 'item:feathery_hotel_coupon'
    WHEN '1x Drug Pack' THEN 'item:drug_pack'
    WHEN '1x Lottery Voucher' THEN 'item:lottery_voucher'
    WHEN '1x Erotic DVD' THEN 'item:erotic_dvd'
    WHEN '1x Box of Grenades' THEN 'item:box_of_grenades'
    WHEN '1x Six-Pack of Energy Drink' THEN 'item:six_pack_of_energy_drink'
    WHEN '1x Six-Pack of Alcohol' THEN 'item:six_pack_of_alcohol'
    WHEN '100 points' THEN 'item:100_points'
    WHEN '1x Random Property' THEN 'item:random_property'
    WHEN '1x Clothing Cache' THEN 'item:clothing_cache'
    WHEN '1x Ammunition Pack' THEN 'item:ammunition_pack'
    WHEN '100 energy' THEN 'item:100_energy'
    WHEN '50 nerve' THEN 'item:50_nerve'
    WHEN '1000 happiness' THEN 'item:1000_happiness'
    ELSE benefit_key
  END,
  benefit_label = CASE json_extract(benefit_json, '$.description')
    WHEN '1x Lawyer''s Business Card' THEN 'Lawyer''s Business Card'
    WHEN '1x Box of Medical Supplies' THEN 'Box of Medical Supplies'
    WHEN '1x Feathery Hotel Coupon' THEN 'Feathery Hotel Coupon'
    WHEN '1x Drug Pack' THEN 'Drug Pack'
    WHEN '1x Lottery Voucher' THEN 'Lottery Voucher'
    WHEN '1x Erotic DVD' THEN 'Erotic DVD'
    WHEN '1x Box of Grenades' THEN 'Box of Grenades'
    WHEN '1x Six-Pack of Energy Drink' THEN 'Six-Pack of Energy Drink'
    WHEN '1x Six-Pack of Alcohol' THEN 'Six-Pack of Alcohol'
    WHEN '100 points' THEN '100 points'
    WHEN '1x Random Property' THEN 'Random Property'
    WHEN '1x Clothing Cache' THEN 'Clothing Cache'
    WHEN '1x Ammunition Pack' THEN 'Ammunition Pack'
    WHEN '100 energy' THEN '100 energy'
    WHEN '50 nerve' THEN '50 nerve'
    WHEN '1000 happiness' THEN '1000 happiness'
    ELSE benefit_label
  END,
  benefit_market_type = CASE json_extract(benefit_json, '$.description')
    WHEN '1x Lawyer''s Business Card' THEN 'itemmarket'
    WHEN '1x Box of Medical Supplies' THEN 'itemmarket'
    WHEN '1x Feathery Hotel Coupon' THEN 'itemmarket'
    WHEN '1x Drug Pack' THEN 'itemmarket'
    WHEN '1x Lottery Voucher' THEN 'itemmarket'
    WHEN '1x Erotic DVD' THEN 'itemmarket'
    WHEN '1x Box of Grenades' THEN 'itemmarket'
    WHEN '1x Six-Pack of Energy Drink' THEN 'itemmarket'
    WHEN '1x Six-Pack of Alcohol' THEN 'itemmarket'
    WHEN '100 points' THEN 'pointsmarket'
    ELSE benefit_market_type
  END,
  benefit_torn_item_id = CASE json_extract(benefit_json, '$.description')
    WHEN '1x Lawyer''s Business Card' THEN 368
    WHEN '1x Box of Medical Supplies' THEN 365
    WHEN '1x Feathery Hotel Coupon' THEN 367
    WHEN '1x Drug Pack' THEN 370
    WHEN '1x Lottery Voucher' THEN 369
    WHEN '1x Erotic DVD' THEN 366
    WHEN '1x Box of Grenades' THEN 364
    WHEN '1x Six-Pack of Energy Drink' THEN 818
    WHEN '1x Six-Pack of Alcohol' THEN 817
    ELSE benefit_torn_item_id
  END,
  benefit_quantity = CASE json_extract(benefit_json, '$.description')
    WHEN '1x Lawyer''s Business Card' THEN 1
    WHEN '1x Box of Medical Supplies' THEN 1
    WHEN '1x Feathery Hotel Coupon' THEN 1
    WHEN '1x Drug Pack' THEN 1
    WHEN '1x Lottery Voucher' THEN 1
    WHEN '1x Erotic DVD' THEN 1
    WHEN '1x Box of Grenades' THEN 1
    WHEN '1x Six-Pack of Energy Drink' THEN 1
    WHEN '1x Six-Pack of Alcohol' THEN 1
    WHEN '100 points' THEN 100
    WHEN '1x Random Property' THEN 1
    WHEN '1x Clothing Cache' THEN 1
    WHEN '1x Ammunition Pack' THEN 1
    WHEN '100 energy' THEN 100
    WHEN '50 nerve' THEN 50
    WHEN '1000 happiness' THEN 1000
    ELSE benefit_quantity
  END
WHERE benefit_json IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_profiles_benefit_key
  ON stock_profiles(benefit_key);
