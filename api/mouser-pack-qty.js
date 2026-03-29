// ============================================================
// api/mouser-pack-qty.js — Mouser pack quantity lookup (proxy + cache write)
//
// Accepts: POST { mpn, partId, apiKey, supabaseUrl, supabaseKey }
// Returns: { packQty, mouserPartNumber, manufacturer, source, cached }
//
// Calling from the browser directly causes CORS/rate-limit issues.
// This serverless function runs on Vercel's servers — no CORS, clean logs.
// The caller is responsible for client-side rate limiting (2100ms between calls).
// ============================================================

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { mpn, partId, apiKey, supabaseUrl, supabaseKey } = req.body || {};
  if (!mpn)    return res.status(400).json({ error: "mpn is required" });
  if (!apiKey) return res.status(400).json({ error: "apiKey is required" });

  try {
    // ── Call Mouser Search API
    const mouserRes = await fetch(
      `https://api.mouser.com/api/v1/search/partnumber?apiKey=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          SearchByPartRequest: { mouserPartNumber: mpn, partSearchOptions: "Exact" },
        }),
      }
    );

    if (!mouserRes.ok) {
      const errText = await mouserRes.text().catch(() => "");
      console.error(`[mouser-pack-qty] ${mpn}: Mouser ${mouserRes.status}`, errText.slice(0, 200));
      return res.json({ packQty: 0, error: `Mouser ${mouserRes.status}` });
    }

    const data = await mouserRes.json();

    if (data.Errors?.length) {
      const msg = data.Errors.map(e => e.Message || e.Code).join(", ");
      console.warn(`[mouser-pack-qty] ${mpn}: Mouser errors — ${msg}`);
      return res.json({ packQty: 0, error: msg });
    }

    const part   = data?.SearchResults?.Parts?.[0];
    const packQty = parseInt(part?.FactoryPackQty || part?.MultPackQty) || 0;
    const mouserPartNumber = part?.MouserPartNumber || "";
    const manufacturer     = part?.ManufacturerName || "";

    // ── Persist factoryPackQty into parts.pricing.mouser so Phase 1 cache
    //    scan finds it on all future auto-fill runs (zero Mouser calls needed)
    if (packQty > 0 && partId && supabaseUrl && supabaseKey) {
      try {
        // Fetch current pricing so we can merge rather than overwrite
        const fetchRes = await fetch(
          `${supabaseUrl}/rest/v1/parts?id=eq.${encodeURIComponent(partId)}&select=pricing`,
          { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
        );
        if (fetchRes.ok) {
          const rows = await fetchRes.json();
          const existing = rows?.[0]?.pricing || {};
          const merged = {
            ...existing,
            mouser: {
              ...(existing.mouser || {}),
              factoryPackQty: packQty,
              mouserPartNumber: mouserPartNumber || (existing.mouser?.mouserPartNumber) || "",
            },
          };
          await fetch(
            `${supabaseUrl}/rest/v1/parts?id=eq.${encodeURIComponent(partId)}`,
            {
              method: "PATCH",
              headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
                "Content-Type": "application/json",
                Prefer: "return=minimal",
              },
              body: JSON.stringify({ pricing: merged }),
            }
          );
        }
      } catch (cacheErr) {
        console.warn(`[mouser-pack-qty] ${mpn}: cache write failed —`, cacheErr.message);
        // Non-fatal — still return the result
      }
    }

    return res.json({ packQty, mouserPartNumber, manufacturer, source: "Mouser" });

  } catch (err) {
    console.error(`[mouser-pack-qty] ${mpn}: unexpected error —`, err.message);
    return res.status(500).json({ error: err.message, packQty: 0 });
  }
}
