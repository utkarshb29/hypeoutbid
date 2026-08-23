-- ============================================================
-- HypeOutbid - Production Schema (v2 - Real Data Only)
-- Run in Supabase SQL Editor
-- ============================================================

-- Drop old objects if migrating
DROP VIEW IF EXISTS leaderboard;
DROP FUNCTION IF EXISTS create_bid CASCADE;
DROP FUNCTION IF EXISTS confirm_payment CASCADE;
DROP TABLE IF EXISTS activity CASCADE;
DROP TABLE IF EXISTS bids CASCADE;
DROP TABLE IF EXISTS webhook_events CASCADE;
DROP TABLE IF EXISTS claim_requests CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- === PROFILES ===
-- Each profile = one person on the leaderboard (created on first successful bid)
CREATE TABLE profiles (
  id                BIGSERIAL PRIMARY KEY,
  handle            TEXT NOT NULL UNIQUE,        -- @username
  name              TEXT,                        -- display name
  avatar            TEXT DEFAULT '"'"'\ud83d\udc64'"'"',
  category          TEXT DEFAULT '"'"'other'"'"',
  instagram_url     TEXT,                        -- full IG URL
  website_url       TEXT,                        -- optional website
  description       TEXT,                        -- short bio
  current_bid_paise INTEGER DEFAULT 0,           -- highest bid in paise
  top_bidder_handle TEXT,                        -- who placed the highest bid
  verified          BOOLEAN DEFAULT false,
  click_count       INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- === BIDS ===
CREATE TABLE bids (
  id                BIGSERIAL PRIMARY KEY,
  profile_id        BIGINT REFERENCES profiles(id),
  bidder_handle     TEXT NOT NULL,
  bidder_email      TEXT NOT NULL,
  amount_paise      INTEGER NOT NULL,
  payment_id        TEXT,
  payment_provider  TEXT DEFAULT '"'"'instamojo'"'"',
  website_url       TEXT,
  description       TEXT,
  category          TEXT,
  status            TEXT DEFAULT '"'"'created'"'"'
                    CHECK (status IN ('"'"'created'"'"','"'"'confirmed'"'"','"'"'failed'"'"')),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- === ACTIVITY ===
CREATE TABLE activity (
  id            BIGSERIAL PRIMARY KEY,
  profile_id    BIGINT REFERENCES profiles(id),
  bidder_handle TEXT NOT NULL,
  amount_paise  INTEGER NOT NULL,
  bid_id        BIGINT REFERENCES bids(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- === WEBHOOK EVENTS (idempotency) ===
CREATE TABLE webhook_events (
  event_id     TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- === LEADERBOARD VIEW ===
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  id, handle, name, avatar, category,
  instagram_url, website_url, description,
  current_bid_paise, top_bidder_handle,
  verified, click_count
FROM profiles
WHERE current_bid_paise > 0
ORDER BY current_bid_paise DESC;

-- === INCREMENT CLICKS FUNCTION ===
CREATE OR REPLACE FUNCTION increment_clicks(p_id BIGINT)
RETURNS void AS $$
BEGIN
  UPDATE profiles SET click_count = click_count + 1 WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- === ENABLE REALTIME ===
ALTER PUBLICATION supabase_realtime ADD TABLE bids;
ALTER PUBLICATION supabase_realtime ADD TABLE activity;
ALTER PUBLICATION supabase_realtime ADD TABLE profiles;

-- === ROW LEVEL SECURITY ===
ALTER TABLE profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids           ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity       ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "profiles_read" ON profiles FOR SELECT USING (true);
CREATE POLICY "bids_read"     ON bids     FOR SELECT USING (true);
CREATE POLICY "activity_read" ON activity  FOR SELECT USING (true);

-- Service role (backend) can do everything - no policy needed (bypasses RLS)
