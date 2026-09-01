/**
 * KITCHEN WRAP MASTERS — Server-side PayFast Payment Creator
 * Netlify Function: /.netlify/functions/create-payment
 *
 * The browser sends the cart (product IDs + quantities + options).
 * This function:
 *   1. Looks up every product's authoritative price from PRICE_LIST (server-side)
 *   2. Recalculates the total — ignoring whatever price the browser sent
 *   3. Builds and returns the PayFast form fields with the correct amount
 *
 * A customer editing prices in DevTools has zero effect — the amount
 * that reaches PayFast is always calculated here, not in the browser.
 *
 * Environment variables required (Netlify Dashboard → Environment Variables):
 *   PAYFAST_MERCHANT_ID  — 25068580
 *   PAYFAST_MERCHANT_KEY — your 13-character merchant key
 *   SITE_URL             — https://classy-gecko-298aad.netlify.app
 */

// ---------------------------------------------------------------------------
// AUTHORITATIVE PRICE LIST
// This is the single source of truth for all product prices.
// Update prices here — never in the HTML product pages.
//
// Structure:
//   [product_id]: { base: <price in Rands> }
//
// For products with options (e.g. video add-on), use option keys:
//   [product_id]: { base: <price>, options: { [option_key]: <additional price> } }
//
// OWNER: Fill in the real prices below before going live.
// ---------------------------------------------------------------------------
const PRICE_LIST = {
  // DIY Fridge Kits
  'diy-double-door-fridge-bundle': {
    base: 0,          // TODO: set real price e.g. 899.00
    options: {
      'installation-video': 0,  // TODO: set real video add-on price e.g. 299.00
    },
  },
  'diy-side-by-side-fridge-bundle': {
    base: 0,          // TODO: set real price
    options: {
      'installation-video': 0,  // TODO: set real video add-on price
    },
  },
  'diy-freezer-bundle': {
    base: 0,          // TODO: set real price
    options: {
      'installation-video': 0,  // TODO: set real video add-on price
    },
  },

  // Vinyl & Materials
  '5m-vinyl-bundle': {
    base: 0,          // TODO: set real price
  },
  '50m-vinyl-roll': {
    base: 0,          // TODO: set real price
  },

  // Vinyl Samples
  'vinyl-sample-pack': {
    base: 0,
    // Variants are priced individually — see variantPrices below
  },
};

// Variant-level pricing for products where different options have different base prices
// Key format: `${product_id}::${variant_name}`
const VARIANT_PRICES = {
  'vinyl-sample-pack::Single Sample':  35,
  'vinyl-sample-pack::5 Colour Pack':  149,
  'vinyl-sample-pack::10 Colour Pack': 249,
};

// Accessories (sold individually, no variants)
const ACCESSORY_PRICES = {
  'professional-application-squeegee': 89,
  'precision-vinyl-cutting-tool':      129,
};

// ---------------------------------------------------------------------------
// Price calculation
// ---------------------------------------------------------------------------

/**
 * Given a cart item from the browser, return the authoritative unit price.
 * Returns null if the product ID is not recognised (order will be rejected).
 */
function getAuthorisedPrice(item) {
  const id      = item.id;
  const variant = item.variant || '';

  // Check accessory list first
  if (ACCESSORY_PRICES[id] !== undefined) {
    return ACCESSORY_PRICES[id];
  }

  // Check variant price table
  // variant string format: "Vinyl: 6m × 1.22m | Colour: Matte Black | Installation Video: Yes"
  // We stored the pack size variant as plain text for sample packs
  const variantKey = `${id}::${variant}`;
  if (VARIANT_PRICES[variantKey] !== undefined) {
    return VARIANT_PRICES[variantKey];
  }

  // Check main price list
  const product = PRICE_LIST[id];
  if (!product) return null;

  let price = product.base;

  // Add option prices if applicable
  // For DIY kits, check if variant string contains "Installation Video: Yes"
  if (product.options && variant.includes('Installation Video: Yes')) {
    price += (product.options['installation-video'] || 0);
  }

  return price;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
exports.handler = async function (event) {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // CORS headers — only allow requests from our own site
  const SITE_URL      = process.env.SITE_URL || '';
  const MERCHANT_ID   = process.env.PAYFAST_MERCHANT_ID;
  const MERCHANT_KEY  = process.env.PAYFAST_MERCHANT_KEY;

  if (!MERCHANT_ID || !MERCHANT_KEY) {
    console.error('KWM CREATE-PAYMENT: Missing PayFast env vars');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error' }),
    };
  }

  // Parse request body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    items = [],
    customer = {},
    delivery = {},
    notes = '',
    orderRef,
  } = body;

  // Validate cart is not empty
  if (!items.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Cart is empty' }) };
  }

  // Validate customer fields
  if (!customer.firstName || !customer.lastName || !customer.email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing customer details' }) };
  }

  // ---------------------------------------------------------------------------
  // Recalculate total server-side — ignore browser-supplied prices entirely
  // ---------------------------------------------------------------------------
  let serverTotal  = 0;
  const validatedItems = [];

  for (const item of items) {
    const unitPrice = getAuthorisedPrice(item);

    if (unitPrice === null) {
      console.warn(`KWM CREATE-PAYMENT: Unknown product id: ${item.id}`);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Unknown product: ${item.id}` }),
      };
    }

    if (unitPrice === 0) {
      // Price not yet configured — block checkout
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: `Price not configured for: ${item.name || item.id}. Please contact us to order.`,
        }),
      };
    }

    const qty = Math.max(1, parseInt(item.qty) || 1);
    serverTotal += unitPrice * qty;
    validatedItems.push({ ...item, price: unitPrice, qty });
  }

  // Round to 2 decimal places (avoid floating point issues)
  serverTotal = Math.round(serverTotal * 100) / 100;

  // PayFast minimum is R5.00
  if (serverTotal < 5) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Order total is below the minimum payment amount of R5.00' }),
    };
  }

  const amountStr = serverTotal.toFixed(2);

  // Build item name summary for PayFast (max 255 chars)
  const itemSummary = validatedItems
    .map(i => `${i.name} x${i.qty}`)
    .join(', ')
    .slice(0, 254);

  // Pack order metadata into custom_str fields for the notify function
  const custom_str3 = [
    delivery.address  || '',
    delivery.city     || '',
    delivery.province || '',
    delivery.postal   || '',
  ].join('|');

  const custom_str4 = encodeURIComponent(JSON.stringify(validatedItems));
  const custom_str5 = [customer.phone || '', notes || ''].join('|');

  // Build PayFast fields
  const payfastFields = {
    merchant_id:   MERCHANT_ID,
    merchant_key:  MERCHANT_KEY,
    return_url:    `${SITE_URL}/order-confirmed/?ref=${orderRef}`,
    cancel_url:    `${SITE_URL}/cart/`,
    notify_url:    `${SITE_URL}/.netlify/functions/payfast-notify`,
    name_first:    customer.firstName,
    name_last:     customer.lastName,
    email_address: customer.email,
    amount:        amountStr,  // ← server-calculated, tamper-proof
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
