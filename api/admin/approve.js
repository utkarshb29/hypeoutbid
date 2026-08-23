const { createClient } = require("@supabase/supabase-js");

const ADMIN_KEY = process.env.ADMIN_SECRET || "hypeoutbid2026";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (req.headers["x-admin-key"] !== ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { bid_id } = req.body;
  if (!bid_id) return res.status(400).json({ error: "Missing bid_id" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Get the bid
  const { data: bid, error: bidErr } = await supabase
    .from("bids")
    .select("*")
    .eq("id", bid_id)
    .single();

  if (bidErr || !bid) return res.status(404).json({ error: "Bid not found" });
  if (bid.status !== "pending") return res.status(400).json({ error: "Bid is not pending" });

  // Approve: update bid status
  await supabase.from("bids").update({ status: "confirmed" }).eq("id", bid_id);

  // Update profile with new bid amount (only if this bid is higher)
  await supabase
    .from("profiles")
    .update({
      current_bid_paise: bid.amount_paise,
      top_bidder_handle: bid.bidder_handle,
      website_url: bid.website_url || undefined,
      description: bid.description || undefined,
      category: bid.category || undefined,
      updated_at: new Date().toISOString()
    })
    .eq("id", bid.profile_id)
    .lt("current_bid_paise", bid.amount_paise + 1);

  // Record activity
  await supabase.from("activity").insert({
    profile_id: bid.profile_id,
    bidder_handle: bid.bidder_handle,
    amount_paise: bid.amount_paise,
    bid_id: bid.id
  });

  return res.status(200).json({ success: true, message: "Bid approved" });
};