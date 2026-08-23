const crypto = require('crypto');
const https = require('https');

// Supabase config
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function supabaseRequest(path, method, body) {
  const url = new URL(path, SUPABASE_URL);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      }
    };
    if (body) options.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { payment_id, status, amount, purpose, buyer_name, buyer, phone } = req.body;
  const SALT = process.env.INSTAMOJO_PRIVATE_SALT;

  // Verify MAC if salt is configured
  if (SALT && req.body.mac) {
    const data = [amount, buyer, buyer_name, payment_id, purpose, status].join('|');
    const mac = crypto.createHmac('sha1', SALT).update(data).digest('hex');
    if (mac !== req.body.mac) {
      return res.status(400).json({ error: 'Invalid MAC signature' });
    }
  }

  if (status !== 'Credit') {
    return res.status(200).json({ message: 'Payment not credited, ignoring' });
  }

  // Payment successful — record the bid in Supabase
  // Purpose format: "Bid on @handle - ProfileID:XX"
  const profileMatch = purpose ? purpose.match(/ProfileID:(\d+)/) : null;
  const handleMatch = purpose ? purpose.match(/Bidder:(@[\w.]+)/) : null;
  const websiteMatch = purpose ? purpose.match(/Website:(.+?)(?:\||$)/) : null;
  const descMatch = purpose ? purpose.match(/Desc:(.+?)(?:\||$)/) : null;

  if (profileMatch) {
    const profileId = parseInt(profileMatch[1]);
    const bidderHandle = handleMatch ? handleMatch[1] : buyer_name;
    const website = websiteMatch ? websiteMatch[1] : null;
    const desc = descMatch ? descMatch[1] : null;
    const amountPaise = Math.round(parseFloat(amount) * 100);

    try {
      await supabaseRequest('/rest/v1/bids', 'POST', {
        profile_id: profileId,
        bidder_handle: bidderHandle,
        bidder_email: buyer,
        amount_paise: amountPaise,
        payment_id: payment_id,
        payment_provider: 'instamojo',
        website_url: website,
        description: desc,
        status: 'confirmed'
      });

      // Update profile's current bid if this is higher
      await supabaseRequest(
        `/rest/v1/profiles?id=eq.${profileId}&current_bid_paise=lt.${amountPaise}`,
        'PATCH',
        {
          current_bid_paise: amountPaise,
          top_bidder_handle: bidderHandle,
          top_bidder_website: website,
          top_bidder_desc: desc
        }
      );
    } catch(e) {
      console.error('Supabase error:', e);
    }
  }

  res.status(200).json({ message: 'Webhook processed' });
};
