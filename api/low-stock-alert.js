// Vercel Cron Job — Daily low-stock email alert
// Triggered daily at 8:00 AM CT via vercel.json cron config
// Checks parts table for stock_qty <= reorder_qty, emails summary

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || "https://qzyxekyrzddoxtdqcnfp.supabase.co",
  process.env.SUPABASE_SERVICE_KEY || ""
);

export default async function handler(req, res) {
  // Verify cron secret (Vercel sends this header for cron jobs)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // 1. Get notify email from api_keys table
    const { data: keys } = await supabase
      .from("api_keys")
      .select("key_name, key_value")
      .in("key_name", ["notify_email"]);

    const notifyEmail = keys?.find((k) => k.key_name === "notify_email")?.key_value;
    if (!notifyEmail) {
      return res.status(200).json({ message: "No notify_email configured, skipping" });
    }

    // 2. Get all parts with stock_qty and reorder_qty set
    const { data: parts, error } = await supabase
      .from("parts")
      .select("reference, mpn, value, description, stock_qty, reorder_qty, preferred_supplier");

    if (error) throw error;

    // 3. Filter to low-stock parts
    const lowStock = (parts || []).filter((p) => {
      const s = parseInt(p.stock_qty);
      const r = parseInt(p.reorder_qty);
      return !isNaN(s) && !isNaN(r) && s <= r;
    });

    if (lowStock.length === 0) {
      return res.status(200).json({ message: "No low-stock parts, no email sent" });
    }

    // 4. Build email body
    const lines = lowStock.map(
      (p) =>
        `  ${p.mpn || p.reference} — Stock: ${p.stock_qty}, Reorder: ${p.reorder_qty}, Need: ${Math.max((parseInt(p.reorder_qty) || 0) - (parseInt(p.stock_qty) || 0), 0)}`
    );

    const body = [
      `Good morning,`,
      ``,
      `${lowStock.length} part${lowStock.length !== 1 ? "s are" : " is"} at or below reorder level:`,
      ``,
      ...lines,
      ``,
      `Would you like me to generate a list of POs and draft emails for you?`,
      `Log in to review: https://jackson-bom.vercel.app`,
      ``,
      `— Jackson Audio BOM Manager`,
    ].join("\n");

    // 5. Send email via Resend (or fall back to logging)
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "BOM Manager <alerts@jackson.audio>",
          to: [notifyEmail],
          subject: `Low Stock Alert — ${lowStock.length} part${lowStock.length !== 1 ? "s" : ""} need reorder`,
          text: body,
        }),
      });
      const emailData = await emailRes.json();
      return res.status(200).json({ message: "Email sent", to: notifyEmail, parts: lowStock.length, emailData });
    }

    // No Resend key — just log
    console.log("LOW STOCK ALERT (no RESEND_API_KEY configured):\n", body);
    return res.status(200).json({
      message: "Low stock detected but no RESEND_API_KEY — set it in Vercel env vars",
      to: notifyEmail,
      parts: lowStock.length,
    });
  } catch (e) {
    console.error("low-stock-alert error:", e);
    return res.status(500).json({ error: e.message });
  }
}
