const { createClient } = require("@supabase/supabase-js");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  if (req.method === "POST") {
    // Increment visit count
    const { error } = await supabase.rpc("increment_visits");
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  // GET: return current count
  const { data, error } = await supabase
    .from("site_stats")
    .select("visit_count")
    .eq("id", 1)
    .single();
  if (error) return res.json({ count: 0 });
  res.json({ count: data.visit_count });
};
