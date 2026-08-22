-- ============================================================
-- Instagram Outbid — Production Schema
-- Run in Supabase SQL Editor (once)
-- ============================================================

-- ── PROFILES ─────────────────────────────────────────────────
CREATE TABLE profiles (
  id                    INTEGER PRIMARY KEY,
  name                  TEXT NOT NULL,
  handle                TEXT NOT NULL UNIQUE,
  avatar                TEXT NOT NULL,
  followers             TEXT NOT NULL,
  engagement            TEXT NOT NULL,
  category              TEXT NOT NULL,
  verified              BOOLEAN DEFAULT true,
  claimed               BOOLEAN DEFAULT false,
  current_bid_paise     INTEGER DEFAULT 100,   -- starts at ₹1 = 100 paise
  current_bidder_handle TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ── BIDS (payment state machine) ─────────────────────────────
-- Status: created → payment_pending → paid | failed
CREATE TABLE bids (
  id                    BIGSERIAL PRIMARY KEY,
  profile_id            INTEGER REFERENCES profiles(id),
  bidder_handle         TEXT NOT NULL,
  bidder_email          TEXT NOT NULL,
  amount_paise          INTEGER NOT NULL,  -- always store as paise, never float
  currency              TEXT DEFAULT 'INR',
  status                TEXT DEFAULT 'created'
                        CHECK (status IN ('created','payment_pending','paid','failed')),
  razorpay_order_id     TEXT UNIQUE,
  razorpay_payment_id   TEXT UNIQUE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  paid_at               TIMESTAMPTZ
);

-- ── ACTIVITY (real feed, not simulated) ──────────────────────
CREATE TABLE activity (
  id            BIGSERIAL PRIMARY KEY,
  profile_id    INTEGER REFERENCES profiles(id),
  bidder_handle TEXT NOT NULL,
  amount_paise  INTEGER NOT NULL,
  bid_id        BIGINT REFERENCES bids(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── WEBHOOK EVENTS (idempotency) ─────────────────────────────
-- Prevents processing the same Razorpay event twice
CREATE TABLE webhook_events (
  event_id    TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── CLAIM REQUESTS ───────────────────────────────────────────
CREATE TABLE claim_requests (
  id          BIGSERIAL PRIMARY KEY,
  profile_id  INTEGER REFERENCES profiles(id),
  email       TEXT NOT NULL,
  handle      TEXT NOT NULL,
  status      TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── ENABLE REALTIME ──────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE bids;
ALTER PUBLICATION supabase_realtime ADD TABLE activity;
ALTER PUBLICATION supabase_realtime ADD TABLE profiles;

-- ── LEADERBOARD VIEW ─────────────────────────────────────────
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  id, name, handle, avatar, followers, engagement, category,
  verified, claimed, current_bid_paise, current_bidder_handle
FROM profiles
ORDER BY current_bid_paise DESC;

-- ── ATOMIC BID FUNCTION ──────────────────────────────────────
-- Called by /api/create-order — locks profile row, rejects underbids
CREATE OR REPLACE FUNCTION create_bid(
  p_profile_id          INTEGER,
  p_bidder_handle       TEXT,
  p_bidder_email        TEXT,
  p_amount_paise        INTEGER,
  p_razorpay_order_id   TEXT
) RETURNS bids AS $$
DECLARE
  v_current INTEGER;
  v_bid     bids;
BEGIN
  SELECT current_bid_paise INTO v_current
  FROM profiles WHERE id = p_profile_id FOR UPDATE;

  IF p_amount_paise <= v_current THEN
    RAISE EXCEPTION 'Bid must exceed current bid of % paise', v_current;
  END IF;

  INSERT INTO bids (profile_id, bidder_handle, bidder_email, amount_paise,
                    razorpay_order_id, status)
  VALUES (p_profile_id, p_bidder_handle, p_bidder_email, p_amount_paise,
          p_razorpay_order_id, 'payment_pending')
  RETURNING * INTO v_bid;

  RETURN v_bid;
END;
$$ LANGUAGE plpgsql;

-- ── CONFIRM PAYMENT FUNCTION ─────────────────────────────────
-- Called by /api/webhook — idempotent, atomic, updates leaderboard
CREATE OR REPLACE FUNCTION confirm_payment(
  p_order_id    TEXT,
  p_payment_id  TEXT,
  p_event_id    TEXT
) RETURNS void AS $$
DECLARE
  v_bid bids;
BEGIN
  -- Idempotency: skip if already processed
  IF EXISTS (SELECT 1 FROM webhook_events WHERE event_id = p_event_id) THEN
    RETURN;
  END IF;

  INSERT INTO webhook_events (event_id) VALUES (p_event_id);

  UPDATE bids
  SET status = 'paid', razorpay_payment_id = p_payment_id, paid_at = NOW()
  WHERE razorpay_order_id = p_order_id AND status = 'payment_pending'
  RETURNING * INTO v_bid;

  IF v_bid IS NULL THEN
    RAISE EXCEPTION 'No pending bid found for order %', p_order_id;
  END IF;

  -- Update leaderboard
  UPDATE profiles
  SET current_bid_paise = v_bid.amount_paise,
      current_bidder_handle = v_bid.bidder_handle,
      updated_at = NOW()
  WHERE id = v_bid.profile_id;

  -- Record in activity feed
  INSERT INTO activity (profile_id, bidder_handle, amount_paise, bid_id)
  VALUES (v_bid.profile_id, v_bid.bidder_handle, v_bid.amount_paise, v_bid.id);
END;
$$ LANGUAGE plpgsql;

-- ── ROW LEVEL SECURITY ────────────────────────────────────────
ALTER TABLE profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids           ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity       ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_requests ENABLE ROW LEVEL SECURITY;

-- Public read access (for frontend + realtime)
CREATE POLICY "profiles_read"       ON profiles       FOR SELECT USING (true);
CREATE POLICY "bids_read"           ON bids           FOR SELECT USING (true);
CREATE POLICY "activity_read"       ON activity       FOR SELECT USING (true);
CREATE POLICY "claims_insert"       ON claim_requests FOR INSERT WITH CHECK (true);

-- Writes are backend-only (service role bypasses RLS)

-- ── SEED PROFILES ────────────────────────────────────────────
INSERT INTO profiles (id, name, handle, avatar, followers, engagement, category, verified) VALUES
(1,  'Cristiano Ronaldo', '@cristiano',     '⚽', '636M', '3.2%', 'athlete',   true),
(2,  'Lionel Messi',      '@leomessi',      '🐐', '504M', '2.8%', 'athlete',   true),
(3,  'Kylie Jenner',      '@kyliejenner',   '💄', '399M', '1.9%', 'celebrity', true),
(4,  'Virat Kohli',       '@virat.kohli',   '🏏', '271M', '3.5%', 'indian',    true),
(5,  'Taylor Swift',      '@taylorswift',   '🎵', '283M', '2.1%', 'music',     true),
(6,  'MrBeast',           '@mrbeast',       '🎬', '245M', '4.2%', 'creator',   true),
(7,  'Narendra Modi',     '@narendramodi',  '🇮🇳', '102M', '2.8%', 'indian',    true),
(8,  'Khaby Lame',        '@khaby00',       '🤷', '162M', '3.8%', 'creator',   true),
(9,  'Dwayne Johnson',    '@therock',       '💪', '395M', '1.5%', 'celebrity', true),
(10, 'Elon Musk',         '@elonmusk',      '🚀', '42M',  '5.1%', 'business',  true),
(11, 'Priyanka Chopra',   '@priyankachopra','⭐', '91M',  '2.4%', 'indian',    true),
(12, 'Neymar Jr',         '@neymarjr',      '🇧🇷', '228M', '2.9%', 'athlete',   true),
(13, 'Shraddha Kapoor',   '@shraddhakapoor','🌸', '87M',  '4.1%', 'indian',    true),
(14, 'Drake',             '@champagnepapi', '🎤', '146M', '1.8%', 'music',     true),
(15, 'PewDiePie',         '@pewdiepie',     '👊', '21M',  '6.2%', 'creator',   true),
(16, 'Nikhil Kamath',     '@nikhil.kamath', '📈', '5M',   '7.8%', 'indian',    false),
(17, 'Billie Eilish',     '@billieeilish',  '🖤', '118M', '2.3%', 'music',     true),
(18, 'Gary Vee',          '@garyvee',       '🍷', '16M',  '4.5%', 'business',  true),
(19, 'Ranveer Singh',     '@ranveersingh',  '🎭', '44M',  '3.9%', 'indian',    true),
(20, 'Mark Zuckerberg',   '@zuck',          '👓', '14M',  '8.1%', 'business',  true);
