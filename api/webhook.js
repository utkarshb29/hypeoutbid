const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const signature = req.headers['x-razorpay-signature'];

  // Verify webhook signature
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  if (signature !== expected) {
    console.error('Webhook signature mismatch');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const event = JSON.parse(rawBody);
  console.log('Webhook received:', event.event, event.payload?.payment?.entity?.id);

  if (event.event === 'payment.captured') {
    const payment = event.payload.payment.entity;
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // Atomic + idempotent via Postgres function
    const { error } = await supabase.rpc('confirm_payment', {
      p_order_id:   payment.order_id,
      p_payment_id: payment.id,
      p_event_id:   event.payload.payment.entity.id, // unique per event
    });

    if (error) {
      // "Already processed" is not an error we care about
      if (!error.message.includes('already')) {
        console.error('confirm_payment error:', error.message);
        return res.status(500).json({ error: 'DB update failed' });
      }
    }
  }

  res.json({ status: 'ok' });
};

module.exports.config = { api: { bodyParser: false } };
