const { createClient } = require("@supabase/supabase-js");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { profile_id } = req.body;
  if (!profile_id) return res.status(400).json({ error: "Missing profile_id" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Increment click count
  const { error } = await supabase.rpc("increment_clicks", { p_id: profile_id });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
};