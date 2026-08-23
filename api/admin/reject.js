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

  // Reject: update bid status to failed
  const { error } = await supabase.from("bids").update({ status: "failed" }).eq("id", bid_id);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ success: true, message: "Bid rejected" });
};