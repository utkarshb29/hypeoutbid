const https = require('https');

module.exports = async (req, res) => {
  const { payment_id, payment_request_id, payment_status } = req.query;

  if (!payment_id || !payment_request_id) {
    return res.redirect('/?payment=failed&reason=missing_params');
  }

  // Verify payment with Instamojo API
  const API_KEY = process.env.INSTAMOJO_API_KEY;
  const AUTH_TOKEN = process.env.INSTAMOJO_AUTH_TOKEN;
  const IS_TEST = process.env.INSTAMOJO_TEST_MODE === 'true';
  const BASE_URL = IS_TEST ? 'test.instamojo.com' : 'www.instamojo.com';

  return new Promise((resolve) => {
    const options = {
      hostname: BASE_URL,
      path: `/api/1.1/payment-requests/${payment_request_id}/${payment_id}/`,
      method: 'GET',
      headers: {
        'X-Api-Key': API_KEY,
        'X-Auth-Token': AUTH_TOKEN
      }
    };

    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.success && result.payment_request.payment.status === 'Credit') {
            // Payment verified! Redirect with success
            const amount = result.payment_request.payment.amount;
            res.redirect(`/?payment=success&amount=${amount}&pid=${payment_id}`);
          } else {
            res.redirect('/?payment=failed&reason=not_credited');
          }
        } catch(e) {
          res.redirect('/?payment=failed&reason=verification_error');
        }
        resolve();
      });
    });

    request.on('error', () => {
      res.redirect('/?payment=failed&reason=network_error');
      resolve();
    });

    request.end();
  });
};
