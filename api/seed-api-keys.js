// api/seed-api-keys.js — Ensure all expected api_key rows exist in DB
// Accepts the Supabase URL + service key via env vars, OR falls back to
// using the anon key + auth token from the client to run privileged inserts.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://qzyxekyrzddoxtdqcnfp.supabase.co";

// Try service role first, fall back to anon key
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
  || "";

const ALL_KEY_NAMES = [
  "nexar_client_id", "nexar_client_secret",
  "mouser_api_key", "mouser_order_api_key",
  "digikey_client_id", "digikey_client_secret",
  "arrow_api_key", "arrow_login",
  "notify_email", "supplier_emails", "tariffs_json", "shipping_json",
  "shopify_stores_json", "company_name", "company_address",
  "distributor_names", "supplier_contacts", "supplier_po_names",
  "supplier_order_modes", "anthropic_api_key",
  "twilio_account_sid", "twilio_auth_token", "twilio_phone_number",
  "labor_rate_hourly", "preferred_supplier", "preferred_supplier_margin",
  "ti_api_key", "ti_api_secret",
  "zoho_client_id", "zoho_client_secret", "zoho_refresh_token", "zoho_org_id",
  "zoho_orgs_json",
  "shipstation_api_key", "shipstation_api_secret",
  "fulfillment_goal_direct", "fulfillment_goal_dealer",
  "timezone", "build_goals_json",
];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    // Use service role client if available
    let sb = SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

    // If no service key, try using the anon key + user's auth token
    if (!sb || !SUPABASE_KEY) {
      const anonKey = req.body?.anonKey;
      const authToken = req.headers.authorization?.replace("Bearer ", "");
      if (anonKey) {
        sb = createClient(SUPABASE_URL, anonKey, {
          global: { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} }
        });
      }
    }

    if (!sb) {
      return res.status(500).json({ error: "No Supabase credentials available. Set SUPABASE_SERVICE_KEY in Vercel env vars." });
    }

    // Get existing rows
    const { data: existing, error: fetchErr } = await sb
      .from("api_keys")
      .select("key_name");
    if (fetchErr) return res.status(500).json({ error: "fetch: " + fetchErr.message });

    const existingNames = new Set((existing || []).map(r => r.key_name));
    const missing = ALL_KEY_NAMES.filter(n => !existingNames.has(n));

    if (missing.length === 0) {
      return res.status(200).json({ message: "All key rows exist", inserted: 0 });
    }

    // Try inserting one by one so partial success is possible
    const inserted = [];
    const failed = [];
    for (const key_name of missing) {
      const { error } = await sb.from("api_keys").insert({ key_name, key_value: "" });
      if (error) {
        failed.push({ key_name, error: error.message });
      } else {
        inserted.push(key_name);
      }
    }

    return res.status(200).json({
      inserted: inserted.length,
      failed: failed.length,
      keys: inserted,
      errors: failed,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
