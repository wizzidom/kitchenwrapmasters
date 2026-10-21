/**
 * KITCHEN WRAP MASTERS — Server-side PayFast Payment Creator
 * Netlify Function: /.netlify/functions/create-payment
 *
 * The browser sends the cart (product IDs + quantities + options).
 * This function:
 *   1. Looks up every product's authoritative price from PRICE_LIST (server-side)
 *   2. Recalculates the total — ignoring whatever price the browser sent
 *   3. Stores the expected amount (in integer cents) against the order reference
 *      in Supabase BEFORE sending the customer to PayFast
 *   4. Returns the PayFast form fields with the correct amount
 *
 * Security model:
 *   - Browser prices are completely ignored.
 *   - The expected amount is stored server-side in pending_orders.
 *   - payfast-notify reads that stored amount and rejects any ITN where
 *     amount_gross doesn't match — closing the under-payment attack surface.
 *
 * Environment variables required (Netlify Dashboard → Environment Variables):
 *   PAYFAST_MERCHANT_ID  — your PayFast merchant ID
 *   PAYFAST_MERCHANT_KEY — your 13-character merchant key
 *   SUPABASE_URL         — https://jxhrbkhzmhnrlqcxgvxa.supabase.co
 *   SUPABASE_SERVICE_KEY — service_role key (NOT the anon key)
 *   SITE_URL             — https://kitchenwrapmasters.co.za
 */

// ---------------------------------------------------------------------------
// AUTHORITATIVE PRICE LIST
// Single source of truth for all product prices (in Rands).
// Update prices here — never in HTML product pages.
// OWNER: Fill in real prices before going live.
// ---------------------------------------------------------------------------
const PRICE_LIST = {
  'diy-double-door-fridge-bundle': {
    base: 1750,
  },
  'diy-side-by-side-fridge-bundle': {
    base: 2150,
  },
  'diy-freezer-bundle': {
    base: 1600,
  },
  '5m-vinyl-bundle': {
    base: 1650,
  },
  '50m-vinyl-roll': {
    base: 7600,
  },
  'vinyl-sample-pack': {
    base: 0,
    // Variants priced individually — see VARIANT_PRICES below
  },
};

// Variant-level pricing — key format: `${product_id}::${variant_name}`
const VARIANT_PRICES = {
  'vinyl-sample-pack::Single Sample':  35,
  'vinyl-sample-pack::5 Colour Pack':  149,
  'vinyl-sample-pack::10 Colour Pack': 249,
};

// Accessories (no variants)
const ACCESSORY_PRICES = {
  'professional-application-squeegee': 200,
  'precision-vinyl-cutting-tool':      200,
};

// ---------------------------------------------------------------------------
// Max quantity per line item
// ---------------------------------------------------------------------------
const MAX_QTY_PER_ITEM = 50;

// ---------------------------------------------------------------------------
// CORS — allowed origins
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = [
  'https://kitchenwrapmasters.co.za',
  'https://www.kitchenwrapmasters.co.za',
  'https://classy-gecko-298aad.netlify.app',
];

function getCorsHeaders(requestOrigin) {
  const origin = ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
    'Vary':                         'Origin',
  };
}

// ---------------------------------------------------------------------------
// Price calculation
// ---------------------------------------------------------------------------

/**
 * Return the authoritative unit price (Rands) for a cart item.
 * Returns null for unrecognised product IDs — order will be rejected.
 */
function getAuthorisedPrice(item) {
  const id      = item.id;
  const variant = item.variant || '';

  if (ACCESSORY_PRICES[id] !== undefined) {
    return ACCESSORY_PRICES[id];
  }

  const variantKey = `${id}::${variant}`;
  if (VARIANT_PRICES[variantKey] !== undefined) {
    return VARIANT_PRICES[variantKey];
  }

  const product = PRICE_LIST[id];
  if (!product) return null;

  return product.base;
}

// ---------------------------------------------------------------------------
// Monetary helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Rand amount to integer cents.
 * Uses Math.round to avoid floating-point drift (e.g. 89.00 → 8900).
 * This is the canonical representation stored in Supabase and used for
 * all comparisons — never compare floating-point Rand values directly.
 */
function randsToCents(rands) {
  return Math.round(parseFloat(rands) * 100);
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

/**
 * Write a pending_orders row with the expected amount before the customer
 * is redirected to PayFast. payfast-notify will read this to verify the
 * actual paid amount matches what the server calculated.
 *
 * Uses upsert (ON CONFLICT DO UPDATE) so that re-submitting the checkout
 * form with the same orderRef (e.g. double-click) safely overwrites the
 * previous pending row rather than failing.
 */
async function storePendingOrder(orderRef, expectedAmountCents, supabaseUrl, serviceKey) {
  const url = `${supabaseUrl}/rest/v1/pending_orders`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      // Upsert: if the order_reference already exists, update expected_amount_cents.
      'Prefer':        'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      order_reference:       orderRef,
      expected_amount_cents: expectedAmountCents,
      // expires_at defaults to now() + 2 hours in Supabase schema
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Supabase pending_orders insert failed: ${response.status} — ${errText}`);
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
exports.handler = async function (event) {
  const requestOrigin = event.headers['origin'] || event.headers['Origin'] || '';
  const corsHeaders   = getCorsHeaders(requestOrigin);

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const SITE_URL      = process.env.SITE_URL || '';
  const MERCHANT_ID   = process.env.PAYFAST_MERCHANT_ID;
  const MERCHANT_KEY  = process.env.PAYFAST_MERCHANT_KEY;
  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;

  if (!MERCHANT_ID || !MERCHANT_KEY) {
    console.error('KWM CREATE-PAYMENT: Missing PayFast env vars');
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Server configuration error' }),
    };
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('KWM CREATE-PAYMENT: Missing Supabase env vars');
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Server configuration error' }),
    };
  }

  // Parse request body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    items    = [],
    customer = {},
    delivery = {},
    notes    = '',
    orderRef,
  } = body;

  // Validate cart is not empty
  if (!items.length) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Cart is empty' }) };
  }

  // Validate customer fields
  if (!customer.firstName || !customer.lastName || !customer.email) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing customer details' }) };
  }

  // Validate orderRef is present and matches expected format
  const ORDER_REF_PATTERN = /^KWM-\d{10,}-[A-Z0-9a-z]{4}$/;
  if (!orderRef || !ORDER_REF_PATTERN.test(orderRef)) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid order reference' }) };
  }

  // ---------------------------------------------------------------------------
  // Recalculate total server-side — ignore browser-supplied prices entirely
  // ---------------------------------------------------------------------------
  let serverTotalRands = 0;
  const validatedItems = [];

  for (const item of items) {
    const unitPrice = getAuthorisedPrice(item);

    if (unitPrice === null) {
      console.warn(`KWM CREATE-PAYMENT: Unknown product id: ${item.id}`);
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: `Unknown product: ${item.id}` }),
      };
    }

    if (unitPrice === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: `Price not configured for: ${item.name || item.id}. Please contact us to order.`,
        }),
      };
    }

    const qty = Math.min(MAX_QTY_PER_ITEM, Math.max(1, parseInt(item.qty) || 1));
    serverTotalRands += unitPrice * qty;
    validatedItems.push({ ...item, price: unitPrice, qty });
  }

  // Round to 2 decimal places to avoid floating-point accumulation
  serverTotalRands = Math.round(serverTotalRands * 100) / 100;

  // PayFast minimum is R5.00
  if (serverTotalRands < 5) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Order total is below the minimum payment amount of R5.00' }),
    };
  }

  // Convert to integer cents — this is what we store and compare against
  const expectedAmountCents = randsToCents(serverTotalRands);
  const amountStr           = serverTotalRands.toFixed(2);

  // ---------------------------------------------------------------------------
  // Store expected amount in Supabase BEFORE sending to PayFast.
  // If this write fails, we abort — we must never send a customer to PayFast
  // without having recorded what we expect them to pay.
  // ---------------------------------------------------------------------------
  try {
    await storePendingOrder(orderRef, expectedAmountCents, SUPABASE_URL, SERVICE_KEY);
    console.log(`KWM CREATE-PAYMENT: Pending order stored — ${orderRef}, ${expectedAmountCents} cents (R${amountStr})`);
  } catch (err) {
    console.error('KWM CREATE-PAYMENT: Failed to store pending order:', err.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Could not initialise order. Please try again.' }),
    };
  }

  // Build item name summary for PayFast (max 255 chars)
  const itemSummary = validatedItems
    .map(i => `${i.name} x${i.qty}`)
    .join(', ')
    .slice(0, 254);

  // Pack order metadata into PayFast custom_str fields
  const custom_str3 = [
    delivery.address  || '',
    delivery.city     || '',
    delivery.province || '',
    delivery.postal   || '',
  ].join('|');

  const custom_str4 = encodeURIComponent(JSON.stringify(validatedItems));
  const custom_str5 = [customer.phone || '', notes || ''].join('|');

  const payfastFields = {
    merchant_id:   MERCHANT_ID,
    merchant_key:  MERCHANT_KEY,
    return_url:    `${SITE_URL}/order-confirmed/?ref=${orderRef}`,
    cancel_url:    `${SITE_URL}/cart/`,
    notify_url:    `${SITE_URL}/.netlify/functions/payfast-notify`,
    name_first:    customer.firstName,
    name_last:     customer.lastName,
    email_address: customer.email,
    amount:        amountStr,  // server-calculated, tamper-proof
    item_name:     itemSummary,
    custom_str1:   orderRef,
    custom_str2:   delivery.method || 'courier',
    custom_str3:   custom_str3,
    custom_str4:   custom_str4,
    custom_str5:   custom_str5,
  };

  console.log(`KWM CREATE-PAYMENT: Order ${orderRef} — R${amountStr} (${validatedItems.length} items)`);

  return {
    statusCode: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({
      success:       true,
      amount:        amountStr,
      payfastFields: payfastFields,
    }),
  };
};
