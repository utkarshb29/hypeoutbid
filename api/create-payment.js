const https = require('https');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { amount, purpose, buyer_name, email, phone, redirect_url, profile_id, bidder_handle } = req.body;

  if (!amount || !purpose || !email) {
    return res.status(400).json({ error: 'Missing required fields: amount, purpose, email' });
  }

  // Instamojo minimum is Rs 9
  if (parseFloat(amount) < 9) {
    return res.status(400).json({ error: 'Minimum amount is ₹9' });
  }

  const API_KEY = process.env.INSTAMOJO_API_KEY;
  const AUTH_TOKEN = process.env.INSTAMOJO_AUTH_TOKEN;
  const IS_TEST = process.env.INSTAMOJO_TEST_MODE === 'true';
  const BASE_URL = IS_TEST ? 'test.instamojo.com' : 'www.instamojo.com';

  const payload = JSON.stringify({
    amount: amount,
    purpose: purpose,
    buyer_name: buyer_name || '',
    email: email,
    phone: phone || '',
    redirect_url: redirect_url || `https://www.hypeoutbid.lol/api/payment-callback`,
    webhook: `https://www.hypeoutbid.lol/api/payment-webhook`,
    allow_repeated_payments: false,
    send_email: false,
    send_sms: false
  });

  return new Promise((resolve) => {
    const options = {
      hostname: BASE_URL,
      path: '/api/1.1/payment-requests/',
      method: 'POST',
      headers: {
        'X-Api-Key': API_KEY,
        'X-Auth-Token': AUTH_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.success) {
            res.status(200).json({
              success: true,
              payment_url: result.payment_request.longurl,
              payment_request_id: result.payment_request.id
            });
          } else {
            res.status(400).json({ success: false, error: result.message || 'Payment request failed' });
          }
        } catch(e) {
          res.status(500).json({ success: false, error: 'Failed to parse Instamojo response' });
        }
        resolve();
      });
    });

    request.on('error', (e) => {
      res.status(500).json({ success: false, error: e.message });
      resolve();
    });

    request.write(payload);
    request.end();
  });
};
