// Vercel Serverless Function — Product Registration
// Public endpoint — no auth required (customers scan QR code)
// POST /api/register — saves registration to product_registrations table

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const {
    serial_number, product_name, brand,
    customer_name, customer_email, customer_phone,
    customer_address, customer_city, customer_state, customer_zip, customer_country,
    purchase_date, purchased_from, dealer_name, notes,
  } = req.body || {};

  if (!serial_number || !customer_name || !customer_email) {
    return res.status(400).json({ error: "Serial number, name, and email are required." });
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)) {
    return res.status(400).json({ error: "Invalid email address." });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return res.status(500).json({ error: "Server configuration error." });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data, error } = await supabase
    .from('product_registrations')
    .insert({
      serial_number: serial_number.trim(),
      product_name: product_name || '',
      brand: brand || 'Jackson Audio',
      customer_name: customer_name.trim(),
      customer_email: customer_email.trim().toLowerCase(),
      customer_phone: (customer_phone || '').trim(),
      customer_address: (customer_address || '').trim(),
      customer_city: (customer_city || '').trim(),
      customer_state: (customer_state || '').trim(),
      customer_zip: (customer_zip || '').trim(),
      customer_country: (customer_country || 'US').trim(),
      purchase_date: (purchase_date || '').trim(),
      purchased_from: (purchased_from || '').trim(),
      dealer_name: (dealer_name || '').trim(),
      notes: (notes || '').trim(),
    })
    .select()
    .single();

  if (error) {
    console.error("Registration insert error:", error);
    return res.status(500).json({ error: "Failed to save registration. Please try again." });
  }

  // Auto-push to Klaviyo if API key is configured
  let klaviyoResult = null;
  const klaviyoKey = await getKlaviyoKey(supabase);
  if (klaviyoKey) {
    klaviyoResult = await pushToKlaviyo(klaviyoKey, {
      email: customer_email.trim().toLowerCase(),
      name: customer_name.trim(),
      phone: (customer_phone || '').trim(),
      address: (customer_address || '').trim(),
      city: (customer_city || '').trim(),
      state: (customer_state || '').trim(),
      zip: (customer_zip || '').trim(),
      country: (customer_country || 'US').trim(),
      serial_number: serial_number.trim(),
      product_name: product_name || '',
      brand: brand || 'Jackson Audio',
      purchased_from: (purchased_from || '').trim(),
      purchase_date: (purchase_date || '').trim(),
    });
  }

  return res.status(200).json({ success: true, registration_id: data.id, klaviyo: klaviyoResult });
}

// ── Klaviyo Integration ──────────────────────────────────────────────────────

async function getKlaviyoKey(supabase) {
  try {
    const { data } = await supabase
      .from('api_keys')
      .select('key_value')
      .eq('key_name', 'klaviyo_api_key')
      .single();
    return data?.key_value || null;
  } catch { return null; }
}

async function pushToKlaviyo(apiKey, customer) {
  try {
    // Create/update profile via Klaviyo API v3
    const profileRes = await fetch('https://a.klaviyo.com/api/profile-import/', {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        'Content-Type': 'application/json',
        revision: '2024-10-15',
      },
      body: JSON.stringify({
        data: {
          type: 'profile',
          attributes: {
            email: customer.email,
            first_name: customer.name.split(' ')[0] || '',
            last_name: customer.name.split(' ').slice(1).join(' ') || '',
            phone_number: customer.phone || undefined,
            location: {
              address1: customer.address || undefined,
              city: customer.city || undefined,
              region: customer.state || undefined,
              zip: customer.zip || undefined,
              country: customer.country || 'US',
            },
            properties: {
              'Product Registered': customer.product_name,
              'Serial Number': customer.serial_number,
              Brand: customer.brand,
              'Purchased From': customer.purchased_from,
              'Purchase Date': customer.purchase_date,
              'Registration Date': new Date().toISOString(),
            },
          },
        },
      }),
    });

    if (!profileRes.ok) {
      const err = await profileRes.text();
      console.error('Klaviyo profile create error:', err);
      return { status: 'error', details: err };
    }

    return { status: 'synced' };
  } catch (e) {
    console.error('Klaviyo push error:', e);
    return { status: 'error', message: e.message };
  }
}
