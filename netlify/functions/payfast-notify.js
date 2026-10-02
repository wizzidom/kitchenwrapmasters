/**
 * KITCHEN WRAP MASTERS — PayFast ITN (Instant Transaction Notification) Handler
 * Netlify Function: /.netlify/functions/payfast-notify
 *
 * PayFast calls this URL server-to-server after every payment.
 * This function:
 *   1.  Validates the POST came from a known PayFast IP
 *   2.  Verifies the MD5 signature (tamper check)
 *   3.  Confirms the merchant ID matches
 *   4.  Checks payment status is COMPLETE
 *   5.  Server-side verification with PayFast's validate endpoint
 *   6.  Idempotency — skips already-processed payments
 *   7.  Retrieves the expected amount (in integer cents) from pending_orders
 *   8.  Compares amount_gross (converted to integer cents) against expected —
 *       rejects the notification if they don't match exactly
 *   9.  Saves the completed order to the orders table
 *
 * Amount-verification model:
 *   create-payment stores expected_amount_cents in pending_orders BEFORE the
 *   customer is redirected to PayFast. This function reads that value and
 *   compares using integer cents, eliminating floating-point imprecision and
 *   closing the under-payment attack surface.
 *
 * Environment variables required (set in Netlify dashboard):
 *   PAYFAST_MERCHANT_ID  — your PayFast merchant ID
 *   PAYFAST_PASSPHRASE   — your PayFast passphrase
 *   SUPABASE_URL         — https://jxhrbkhzmhnrlqcxgvxa.supabase.co
 *   SUPABASE_SERVICE_KEY — service_role key (NOT the anon key)
 *   SITE_URL             — https://kitchenwrapmasters.co.za
 */

const crypto = require('crypto');
const https  = require('https');

// ---------------------------------------------------------------------------
// PayFast valid server IPs
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
 * Parse URL-encoded body, preserving original field order (critical for signature).
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
 * Build the MD5 signature PayFast expects.
 * Preserves field order from the POST body (do NOT sort alphabetically).
 * Appends passphrase at the end if set.
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
 * Convert a Rand string or number to integer cents.
 * Math.round eliminates floating-point imprecision.
 * e.g. "89.00" → 8900, "249.00" → 24900
 */
function randsToCents(rands) {
  return Math.round(parseFloat(rands) * 100);
}

/**
 * Server-side payment verification with PayFast.
 */
function verifyWithPayfast(pfPaymentId, merchantId) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'www.payfast.co.za',
      path:     '/eng/query/validate',
      method:   'POST',
      headers:  { 'Content-Type': 'application/x-www-form-urlencoded' },
    };

    const postData = `pf_payment_id=${pfPaymentId}&merchant_id=${merchantId}`;

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => { resolve(data.trim().toUpperCase() === 'VALID'); });
    });

    req.on('error', () => resolve(false));
    req.setTimeout(8000, () => { req.destroy(); resolve(false); });
    req.write(postData);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

/**
 * Retrieve the pending_orders row for this order reference.
 * Returns null if not found or already expired.
 * Returns the row object { order_reference, expected_amount_cents, expires_at } if found.
 */
async function getPendingOrder(orderRef, supabaseUrl, serviceKey) {
  const url = `${supabaseUrl}/rest/v1/pending_orders`
    + `?order_reference=eq.${encodeURIComponent(orderRef)}&limit=1`;

  const response = await fetch(url, {
    method:  'GET',
    headers: {
      'apikey':        serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
    },
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Supabase pending_orders lookup failed: ${response.status} — ${err}`);
  }

  const rows = await response.json();
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Lookup an existing completed order by pf_payment_id (idempotency check).
 */
async function findExistingOrder(pfPaymentId, supabaseUrl, serviceKey) {
  const url = `${supabaseUrl}/rest/v1/orders`
    + `?pf_payment_id=eq.${encodeURIComponent(pfPaymentId)}&limit=1`;

  const response = await fetch(url, {
    method:  'GET',
    headers: {
      'apikey':        serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
    },
  });

  if (!response.ok) return null;
  const rows = await response.json();
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Insert the completed order into the orders table.
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
    throw new Error(`Supabase orders insert failed: ${response.status} — ${error}`);
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const MERCHANT_ID   = process.env.PAYFAST_MERCHANT_ID;
  const PASSPHRASE    = process.env.PAYFAST_PASSPHRASE;
  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;

  if (!MERCHANT_ID || !PASSPHRASE || !SUPABASE_URL || !SERVICE_KEY) {
    console.error('KWM PAYFAST: Missing environment variables');
    return { statusCode: 500, body: 'Server configuration error' };
  }

  const pfData = parseBody(event.body || '');
  console.log('KWM PAYFAST: Received ITN for payment_id:', pfData.pf_payment_id);

  // --- Step 1: IP validation ---
  const sourceIp = event.headers['x-forwarded-for']?.split(',')[0]?.trim()
                || event.headers['x-nf-client-connection-ip']
                || '';

  if (!PAYFAST_VALID_IPS.includes(sourceIp)) {
    console.warn(`KWM PAYFAST: Blocked request from invalid source IP: ${sourceIp}`);
    return { statusCode: 400, body: 'Invalid source IP' };
  }

  // --- Step 2: Signature verification ---
  const receivedSignature = pfData.signature;
  const expectedSignature = generateSignature(pfData, PASSPHRASE);

  if (receivedSignature !== expectedSignature) {
    console.error('KWM PAYFAST: Signature mismatch', {
      received: receivedSignature,
      expected: expectedSignature,
    });
    return { statusCode: 400, body: 'Invalid signature' };
  }

  // --- Step 3: Merchant ID check ---
  if (pfData.merchant_id !== MERCHANT_ID) {
    console.error('KWM PAYFAST: Merchant ID mismatch');
    return { statusCode: 400, body: 'Invalid merchant' };
  }

  // --- Step 4: Payment status check ---
  if (pfData.payment_status !== 'COMPLETE') {
    console.log(`KWM PAYFAST: Payment not complete. Status: ${pfData.payment_status}`);
    return { statusCode: 200, body: 'OK' };
  }

  // --- Step 5: Server-side verification with PayFast ---
  const isValid = await verifyWithPayfast(pfData.pf_payment_id, MERCHANT_ID);
  if (!isValid) {
    console.error('KWM PAYFAST: Server-side PayFast verification failed for', pfData.pf_payment_id);
    return { statusCode: 400, body: 'Payment verification failed' };
  }

  // --- Step 6: Idempotency — skip already-processed payments ---
  try {
    const existingOrder = await findExistingOrder(pfData.pf_payment_id, SUPABASE_URL, SERVICE_KEY);
    if (existingOrder) {
      console.log(`KWM PAYFAST: Duplicate ITN — payment ${pfData.pf_payment_id} already processed`);
      return { statusCode: 200, body: 'OK' };
    }
  } catch (err) {
    // Log but continue — the unique constraint is the backstop
    console.warn('KWM PAYFAST: Could not check for duplicate order:', err.message);
  }

  // --- Step 7: Retrieve expected amount from pending_orders ---
  // The order reference was generated by create-payment and stored in custom_str1.
  const orderRef = pfData.custom_str1 || '';

  let pendingOrder;
  try {
    pendingOrder = await getPendingOrder(orderRef, SUPABASE_URL, SERVICE_KEY);
  } catch (err) {
    console.error('KWM PAYFAST: Could not retrieve pending order:', err.message);
    // Return 500 so PayFast retries — this is a transient DB error, not fraud
    return { statusCode: 500, body: 'Temporary error — will retry' };
  }

  if (!pendingOrder) {
    // No pending record means either:
    //   a) The order reference is fake/tampered, or
    //   b) The create-payment step never completed (e.g. DB was unavailable)
    // Either way, we cannot verify the amount — reject.
    console.error(`KWM PAYFAST: No pending_orders record found for order_reference: "${orderRef}"`);
    return { statusCode: 400, body: 'Order not found' };
  }

  // Check the pending record has not expired
  const expiresAt = new Date(pendingOrder.expires_at);
  if (Date.now() > expiresAt.getTime()) {
    console.error(`KWM PAYFAST: Pending order expired for ${orderRef} (expired ${expiresAt.toISOString()})`);
    return { statusCode: 400, body: 'Order expired' };
  }

  // --- Step 8: Amount verification (integer cents comparison) ---
  //
  // Both sides are converted to integer cents before comparison.
  // This eliminates floating-point precision issues (e.g. 89.00 * 100 = 8899.999...)
  // and makes the comparison exact and safe.
  //
  // The expected amount was calculated entirely server-side in create-payment.js
  // from the authoritative price list — it was never derived from browser input.
  //
  // Comparison: received cents must equal expected cents EXACTLY.
  // A received amount of even R0.01 less than expected is rejected.

  const receivedCents = randsToCents(pfData.amount_gross || '0');
  const expectedCents = pendingOrder.expected_amount_cents;  // integer, from DB

  if (receivedCents !== expectedCents) {
    console.error(
      `KWM PAYFAST: Amount mismatch for ${orderRef} — ` +
      `received ${receivedCents} cents (R${(receivedCents / 100).toFixed(2)}), ` +
      `expected ${expectedCents} cents (R${(expectedCents / 100).toFixed(2)})`
    );
    return { statusCode: 400, body: 'Amount mismatch' };
  }

  console.log(`KWM PAYFAST: Amount verified — ${orderRef} R${(receivedCents / 100).toFixed(2)}`);

  // --- Step 9: Parse order data from custom_str fields ---
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
    order_reference:     orderRef,
    amount_gross:        receivedCents / 100,  // store as Rands (2 dp) in orders table
    amount_fee:          parseFloat(pfData.amount_fee  || 0),
    amount_net:          parseFloat(pfData.amount_net  || 0),
    customer_first_name: pfData.name_first     || '',
    customer_last_name:  pfData.name_last      || '',
    customer_email:      pfData.email_address  || '',
    customer_phone:      contactParts[0]       || '',
    delivery_method:     pfData.custom_str2    || '',
    delivery_address:    addressParts[0]       || '',
    delivery_city:       addressParts[1]       || '',
    delivery_province:   addressParts[2]       || '',
    delivery_postal:     addressParts[3]       || '',
    items:               items,
    notes:               contactParts[1]       || '',
    item_name:           pfData.item_name      || '',
    fulfilment_status:   'pending',
  };

  // --- Step 10: Save to Supabase ---
  try {
    await saveOrderToSupabase(order, SUPABASE_URL, SERVICE_KEY);
    console.log(`KWM PAYFAST: Order saved — ${order.order_reference} (${order.pf_payment_id}) R${order.amount_gross.toFixed(2)}`);
  } catch (err) {
    // Duplicate key (23505) = already saved by a concurrent ITN — return 200
    if (err.message && err.message.includes('23505')) {
      console.log(`KWM PAYFAST: Duplicate key on insert for ${pfData.pf_payment_id} — returning 200`);
      return { statusCode: 200, body: 'OK' };
    }
    console.error('KWM PAYFAST: Supabase orders save failed:', err.message);
    return { statusCode: 500, body: 'Database error — will retry' };
  }

  return { statusCode: 200, body: 'OK' };
};
