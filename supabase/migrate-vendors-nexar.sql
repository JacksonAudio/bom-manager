-- Add additional distributors available via Nexar/Octopart pricing data
-- Domestic (US-based) distributors
INSERT INTO vendors (slug, display_name, website, is_api_supplier, is_locked_supplier, is_domestic) VALUES
  ('newark',        'Newark Electronics',      'https://www.newark.com',          TRUE,  FALSE, TRUE),
  ('rs components', 'RS Components',           'https://www.rsdelivers.com',       TRUE,  FALSE, TRUE),
  ('avnet',         'Avnet',                   'https://www.avnet.com',            TRUE,  FALSE, TRUE),
  ('future',        'Future Electronics',      'https://www.futureelectronics.com',TRUE,  FALSE, TRUE),
  ('ttelectronics', 'TTI Inc.',                'https://www.ttiinc.com',           TRUE,  FALSE, TRUE),
  ('verical',       'Verical',                 'https://www.verical.com',          TRUE,  FALSE, TRUE),
  ('chip1stop',     'Chip 1 Stop',             'https://www.chip1stop.com',        TRUE,  FALSE, TRUE),
  ('tti',           'TTI',                     'https://www.ttiinc.com',           TRUE,  FALSE, TRUE),
  ('onlinecomponents','Online Components',     'https://www.onlinecomponents.com', TRUE,  FALSE, TRUE),
  ('questcomponents','Quest Components',       'https://www.questcomp.com',        TRUE,  FALSE, TRUE),
  ('rocelec',       'Rochester Electronics',   'https://www.rocelec.com',          TRUE,  FALSE, TRUE),
  ('sager',         'Sager Electronics',       'https://www.sager.com',            TRUE,  FALSE, TRUE),
  ('heilind',       'Heilind Electronics',     'https://www.heilind.com',          TRUE,  FALSE, TRUE),
  ('sps',           'SPS Commerce',            'https://www.spscommerce.com',      TRUE,  FALSE, TRUE),
  ('amazon',        'Amazon',                  'https://www.amazon.com',           FALSE, FALSE, TRUE),
  ('mcmaster-carr', 'McMaster-Carr',           'https://www.mcmaster.com',         FALSE, TRUE,  TRUE),
  ('bolt depot',    'Bolt Depot',              'https://www.boltdepot.com',        FALSE, TRUE,  TRUE),
  ('ce dist',       'CE Distribution',         'https://www.cedist.com',           FALSE, TRUE,  TRUE)
ON CONFLICT (slug) DO NOTHING;

-- International distributors
INSERT INTO vendors (slug, display_name, website, is_api_supplier, is_locked_supplier, is_domestic) VALUES
  ('lcsc',          'LCSC Electronics',        'https://www.lcsc.com',             TRUE,  FALSE, FALSE),
  ('farnell',       'Farnell',                 'https://www.farnell.com',          TRUE,  FALSE, FALSE),
  ('element14',     'element14',               'https://www.element14.com',        TRUE,  FALSE, FALSE),
  ('tme',           'TME',                     'https://www.tme.eu',               TRUE,  FALSE, FALSE),
  ('rutronik',      'Rutronik',                'https://www.rutronik.com',         TRUE,  FALSE, FALSE),
  ('electrocomponents','Electrocomponents',    'https://www.electrocomponents.com',TRUE,  FALSE, FALSE),
  ('chipsmall',     'Chipsmall',               'https://www.chipsmall.com',        TRUE,  FALSE, FALSE),
  ('szlcsc',        'SZLCSC',                  'https://www.szlcsc.com',           TRUE,  FALSE, FALSE),
  ('utmel',         'UTMEL',                   'https://www.utmel.com',            TRUE,  FALSE, FALSE),
  ('hkinventory',   'HKInventory',             'https://www.hkinventory.com',      TRUE,  FALSE, FALSE),
  ('ic-components', 'IC Components',           'https://www.ic-components.com',    TRUE,  FALSE, FALSE),
  ('soselectronic', 'SOS Electronic',          'https://www.soselectronic.com',    TRUE,  FALSE, FALSE),
  ('arrow asia',    'Arrow Asia',              'https://www.arrow.com',            TRUE,  FALSE, FALSE)
ON CONFLICT (slug) DO NOTHING;
