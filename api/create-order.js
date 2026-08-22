const Razorpay = require('razorpay');
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { amount_rupees, profile_id, bidder_handle, bidder_email } = req.body;

  if (!amount_rupees || !profile_id || !bidder_handle || !bidder_email) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const amount_paise = Math.round(Number(amount_rupees) * 100);
  if (amount_paise < 100) {
    return res.status(400).json({ error: 'Minimum bid is ₹1' });
  }

  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });

  // Create Razorpay order first (get order_id)
  let order;
  try {
    order = await razorpay.orders.create({
      amount: amount_paise,
      currency: 'INR',
      notes: { profile_id: String(profile_id), bidder_handle, bidder_email },
    });
  } catch (err) {
    console.error('Razorpay create order failed:', err);
    return res.status(500).json({ error: 'Payment service unavailable' });
  }

  // Atomic bid creation via Postgres function (handles lock + underbid check)
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data, error } = await supabase.rpc('create_bid', {
    p_profile_id: Number(profile_id),
    p_bidder_handle: bidder_handle,
    p_bidder_email: bidder_email,
    p_amount_paise: amount_paise,
    p_razorpay_order_id: order.id,
  });

  if (error) {
    console.error('create_bid error:', error.message);
    // Cancel the Razorpay order since we won't use it
    return res.status(400).json({ error: error.message.includes('must exceed') ? error.message : 'Bid rejected' });
  }

  res.json({ order_id: order.id, amount: order.amount, currency: order.currency });
};
