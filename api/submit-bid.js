const { createClient } = require("@supabase/supabase-js");

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { amount_paise, handle, email, website, description, category, utr, profile_id } = req.body;

  // Validate
  if (!amount_paise || !handle || !email || !utr) {
    return res.status(400).json({ error: "Missing required fields", success: false });
  }
  if (amount_paise < 1000) {
    return res.status(400).json({ error: "Minimum bid is 10 INR", success: false });
  }
  if (utr.length < 8) {
    return res.status(400).json({ error: "Invalid UTR", success: false });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const cleanHandle = handle.startsWith("@") ? handle : "@" + handle;
  const igUrl = "https://instagram.com/" + cleanHandle.replace("@", "");

  try {
    // Check if this UTR was already used
    const { data: existingBid } = await supabase
      .from("bids")
      .select("id")
      .eq("payment_id", utr)
      .limit(1);
    if (existingBid && existingBid.length > 0) {
      return res.status(400).json({ error: "This UTR was already used", success: false });
    }

    // If outbidding someone, check minimum amount
    if (profile_id && profile_id !== 0) {
      const { data: target } = await supabase
        .from("profiles")
        .select("current_bid_paise")
        .eq("id", profile_id)
        .single();
      if (target && amount_paise <= target.current_bid_paise) {
        return res.status(400).json({ error: "Must exceed current bid of " + (target.current_bid_paise/100) + " INR", success: false });
      }
    }

    // Always find or create the BIDDER OWN profile (by handle)
    let targetProfileId;
    const { data: existing } = await supabase
      .from("profiles")
      .select("id, current_bid_paise")
      .eq("handle", cleanHandle)
      .limit(1);

    if (existing && existing.length > 0) {
      targetProfileId = existing[0].id;
    } else {
      // Create new profile for this bidder
      const { data: created, error: createErr } = await supabase
        .from("profiles")
        .insert({
          handle: cleanHandle,
          name: cleanHandle.replace("@", ""),
          category: category || "other",
          instagram_url: igUrl,
          website_url: website || null,
          description: description || null,
          current_bid_paise: 0,
          top_bidder_handle: cleanHandle
        })
        .select("id")
        .single();
      if (createErr) {
        return res.status(500).json({ error: "Failed to create profile: " + createErr.message, success: false });
      }
      targetProfileId = created.id;
    }

    // Record the bid against the bidder own profile
    const { data: bid, error: bidErr } = await supabase
      .from("bids")
      .insert({
        profile_id: targetProfileId,
        bidder_handle: cleanHandle,
        bidder_email: email,
        amount_paise: amount_paise,
        payment_id: utr,
        payment_provider: "upi_qr",
        website_url: website || null,
        description: description || null,
        category: category || "other",
        status: "pending"
      })
      .select("id")
      .single();
    if (bidErr) {
      return res.status(500).json({ error: "Failed to record bid: " + bidErr.message, success: false });
    }

    return res.status(200).json({ success: true, message: "Bid submitted! Will appear after payment verification." });
  } catch(e) {
    return res.status(500).json({ error: "Server error: " + e.message, success: false });
  }
};