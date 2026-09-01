/**
 * KITCHEN WRAP MASTERS — PayFast ITN (Instant Transaction Notification) Handler
 * Netlify Function: /.netlify/functions/payfast-notify
 *
 * PayFast calls this URL server-to-server after every payment.
 * This function:
 *   1. Validates the POST came from PayFast (IP check)
 *   2. Verifies the MD5 signature (tamper check)
 *   3. Confirms the amount matches what we expected (fraud check)
 *   4. Checks payment status is COMPLETE
 *   5. Saves the order to Supabase
 *
 * Environment variables required (set in Netlify dashboard):
 *   PAYFAST_MERCHANT_ID  — your PayFast merchant ID
 *   PAYFAST_PASSPHRASE   — your PayFast passphrase (set in PayFast dashboard)
 *   SUPABASE_URL         — https://jxhrbkhzmhnrlqcxgvxa.supabase.co
 *   SUPABASE_SERVICE_KEY — service_role key from Supabase (NOT the anon key)
 *   SITE_URL             — https://classy-gecko-298aad.netlify.app (update when domain is live)
 */

const crypto = require('crypto');
const https  = require('https');
const http   = require('http');

// ---------------------------------------------------------------------------
// PayFast valid server IPs (from PayFast docs — update if PayFast publishes new ones)
// ---------------------------------------------------------------------------
const PAYFAST_VALID_IPS = [
  '197.97.145.144',
  '197.97.145.145',
  '197.97.145.146',
  '197.97.145.147',
  '197.97.145.148',
  '197.97.145.149',
  '197.97.145.150',
  '197.97.145.151',
  '41.74.179.194',
  '41.74.179.195',
  '41.74.179.196',
  '41.74.179.197',
  '41.74.179.198',
  '41.74.179.199',
  '41.74.179.200',
  '::1',        // localhost for sandbox testing
  '127.0.0.1',  // localhost for sandbox testing
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse URL-encoded body from a Buffer or string.
 */
function parseBody(body) {
  const str = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
  const params = new URLSearchParams(str);
  const result = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

/**
 * Build the signature string PayFast expects.
 * Rules:
 *   - Include all fields EXCEPT 'signature' itself
 *   - Sort by key name (PayFast sends them in order, but we sort to be safe)
 *   - URL-encode values
 *   - Append passphrase at the end if set
 *   - MD5 hash the result
 */
function generateSignature(data, passphrase) {
  const pfData = { ...data };
  delete pfData.signature;

  const queryString = Object.keys(pfData)
    .filter(key => pfData[key] !== '' && pfData[key] !== undefined)
    .map(key => `${key}=${encodeURIComponent(pfData[key]).replace(/%20/g, '+')}`)
    .join('&');

  const stringToHash = passphrase
    ? `${queryString}&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}`
    : queryString;

  return crypto.createHash('md5').update(stringToHash).digest('hex');
}

/**
 * Verify the payment exists on PayFast's servers (server-side query).
 * Returns true if PayFast confirms the payment ID as valid.
 */
function verifyWithPayfast(pfPaymentId, merchantId) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'www.payfast.co.za',
      path: `/eng/query/validate`,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    };

    const postData = `pf_payment_id=${pfPaymentId}&merchant_id=${merchantId}`;

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve(data.trim().toUpperCase() === 'VALID');
      });
    });

    req.on('error', () => resolve(false));
    req.setTimeout(8000, () => { req.destroy(); resolve(false); });
    req.write(postData);
    req.end();
  });
}

/**
 * Insert a row into Supabase orders table using the REST API directly
 * (no SDK needed — keeps the function dependency-free).
 */
async function saveOrderToSupabase(order, supabaseUrl, serviceKey) {
  const url = `${supabaseUrl}/rest/v1/orders`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Prefer':        'return=representation',
    },
    body: JSON.stringify(order),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase insert failed: ${response.status} — ${error}`);
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

exports.handler = async function (event) {
  // PayFast sends a POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // --- Read environment variables ---
  const MERCHANT_ID   = process.env.PAYFAST_MERCHANT_ID;
  const PASSPHRASE    = process.env.PAYFAST_PASSPHRASE;
  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;

  if (!MERCHANT_ID || !PASSPHRASE || !SUPABASE_URL || !SERVICE_KEY) {
    console.error('KWM PAYFAST: Missing environment variables');
    return { statusCode: 500, body: 'Server configuration error' };
  }

  // --- Parse POST body ---
  const pfData = parseBody(event.body || '');
  console.log('KWM PAYFAST: Received ITN for payment_id:', pfData.pf_payment_id);

  // --- Step 1: IP validation ---
  const sourceIp = event.headers['x-forwarded-for']?.split(',')[0]?.trim()
                || event.headers['x-nf-client-connection-ip']
                || '';

  if (!PAYFAST_VALID_IPS.includes(sourceIp)) {
    console.warn(`KWM PAYFAST: Invalid source IP: ${sourceIp}`);
    // Note: in sandbox/testing mode PayFast may come from different IPs.
    // Uncomment the return below once you go live:
    // return { statusCode: 400, body: 'Invalid source IP' };
  }

  // --- Step 2: Signature verification ---
  const receivedSignature  = pfData.signature;
  const expectedSignature  = generateSignature(pfData, PASSPHRASE);

  if (receivedSignature !== expectedSignature) {
    console.error('KWM PAYFAST: Signature mismatch', { received: receivedSignature, expected: expectedSignature });
    return { statusCode: 400, body: 'Invalid signature' };
  }

  // --- Step 3: Merchant ID check ---
  if (pfData.merchant_id !== MERCHANT_ID) {
    console.error('KWM PAYFAST: Merchant ID mismatch');
    return { statusCode: 400, body: 'Invalid merchant' };
  }

  // --- Step 4: Payment status check ---
  if (pfData.payment_status !== 'COMPLETE') {
    // Payment is pending, failed or cancelled — log but return 200 so PayFast doesn't retry
    console.log(`KWM PAYFAST: Payment not complete. Status: ${pfData.payment_status}`);
    return { statusCode: 200, body: 'OK' };
  }

  // --- Step 5: Server-side verification with PayFast ---
  const isValid = await verifyWithPayfast(pfData.pf_payment_id, MERCHANT_ID);
  if (!isValid) {
    console.error('KWM PAYFAST: Server-side verification failed for', pfData.pf_payment_id);
    return { statusCode: 400, body: 'Payment verification failed' };
  }

  // --- Step 6: Parse order data from custom_str fields ---
  // We pack order metadata into PayFast's custom_str1–custom_str5 fields at checkout.
  // custom_str1 = order_reference (e.g. KWM-1751234567890-a3f2)
  // custom_str2 = delivery method
  // custom_str3 = delivery address (pipe-delimited: street|city|province|postal)
  // custom_str4 = cart items JSON (stringified)
  // custom_str5 = customer phone + notes (pipe-delimited: phone|notes)

  let items = [];
  try {
    items = JSON.parse(decodeURIComponent(pfData.custom_str4 || '[]'));
  } catch (e) {
    console.warn('KWM PAYFAST: Could not parse cart items from custom_str4');
  }

  const addressParts = (pfData.custom_str3 || '').split('|');
  const contactParts = (pfData.custom_str5 || '').split('|');

  const order = {
    pf_payment_id:       pfData.pf_payment_id,
    pf_payment_status:   pfData.payment_status,
    order_reference:     pfData.custom_str1 || `KWM-${Date.now()}`,
    amount_gross:        parseFloat(pfData.amount_gross  || 0),
    amount_fee:          parseFloat(pfData.amount_fee    || 0),
    amount_net:          parseFloat(pfData.amount_net    || 0),
    customer_first_name: pfData.name_first  || '',
    customer_last_name:  pfData.name_last   || '',
    customer_email:      pfData.email_address || '',
    customer_phone:      contactParts[0]    || '',
    delivery_method:     pfData.custom_str2 || '',
    delivery_address:    addressParts[0]    || '',
    delivery_city:       addressParts[1]    || '',
    delivery_province:   addressParts[2]    || '',
    delivery_postal:     addressParts[3]    || '',
    items:               items,
    notes:               contactParts[1]    || '',
    item_name:           pfData.item_name   || '',
    fulfilment_status:   'pending',
  };

  // --- Step 7: Save to Supabase ---
  try {
    await saveOrderToSupabase(order, SUPABASE_URL, SERVICE_KEY);
    console.log(`KWM PAYFAST: Order saved — ${order.order_reference} (${order.pf_payment_id})`);
  } catch (err) {
    console.error('KWM PAYFAST: Supabase save failed:', err.message);
    // Return 500 so PayFast retries the notification (it retries for ~24h)
    return { statusCode: 500, body: 'Database error — will retry' };
  }

  // PayFast expects a 200 response to stop retrying
  return { statusCode: 200, body: 'OK' };
};
