// ============================================================
// api/scrape-part.js — Scrape part details from distributor pages
//
// Fetches the product page HTML and extracts structured data
// that APIs often miss: Country of Origin, Country of Assembly,
// Country of Diffusion, and the canonical product URL.
// ============================================================

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url parameter is required" });

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    // Only allow known distributor domains
    const allowed = ["mouser.com", "www.mouser.com", "digikey.com", "www.digikey.com", "arrow.com", "www.arrow.com", "lcsc.com", "www.lcsc.com"];
    if (!allowed.some(d => host === d || host.endsWith("." + d))) {
      return res.status(400).json({ error: "Unsupported distributor domain" });
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Failed to fetch page: ${response.status}` });
    }

    const html = await response.text();
    const result = { url: parsed.href };

    if (host.includes("mouser.com")) {
      // Extract Country of Origin
      const cooMatch = html.match(/Country\s+of\s+Origin[:\s]*<\/(?:td|th|dt|span|div|b|strong)[^>]*>\s*<(?:td|dd|span|div)[^>]*>\s*([A-Z]{2})/i)
        || html.match(/Country\s+of\s+Origin[:\s]*(?:<[^>]*>)*\s*([A-Z]{2,3})/i)
        || html.match(/"countryOfOrigin"\s*:\s*"([^"]+)"/i);
      if (cooMatch) result.countryOfOrigin = cooMatch[1].toUpperCase();

      // Extract Country of Assembly
      const coaMatch = html.match(/Country\s+of\s+Assembly[:\s]*<\/(?:td|th|dt|span|div|b|strong)[^>]*>\s*<(?:td|dd|span|div)[^>]*>\s*([A-Z]{2})/i)
        || html.match(/Country\s+of\s+Assembly[:\s]*(?:<[^>]*>)*\s*([A-Z]{2,3})/i);
      if (coaMatch) result.countryOfAssembly = coaMatch[1].toUpperCase();

      // Extract Country of Diffusion
      const codMatch = html.match(/Country\s+of\s+Diffusion[:\s]*<\/(?:td|th|dt|span|div|b|strong)[^>]*>\s*<(?:td|dd|span|div)[^>]*>\s*([A-Z]{2})/i)
        || html.match(/Country\s+of\s+Diffusion[:\s]*(?:<[^>]*>)*\s*([A-Z]{2,3})/i);
      if (codMatch) result.countryOfDiffusion = codMatch[1].toUpperCase();

      // Try JSON-LD or embedded structured data
      const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
      if (jsonLdMatch) {
        for (const block of jsonLdMatch) {
          try {
            const jsonStr = block.replace(/<\/?script[^>]*>/gi, "");
            const ld = JSON.parse(jsonStr);
            if (ld.countryOfOrigin && !result.countryOfOrigin) result.countryOfOrigin = String(ld.countryOfOrigin).toUpperCase();
            if (ld.countryOfAssembly && !result.countryOfAssembly) result.countryOfAssembly = String(ld.countryOfAssembly).toUpperCase();
          } catch {}
        }
      }

      // Extract from meta tags or data attributes as additional fallback
      const metaCoo = html.match(/data-country-of-origin="([^"]+)"/i)
        || html.match(/name="countryOfOrigin"\s+content="([^"]+)"/i);
      if (metaCoo && !result.countryOfOrigin) result.countryOfOrigin = metaCoo[1].toUpperCase();

      // Try to find in the specifications table (common Mouser layout)
      // Look for table rows with these labels
      const specRows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
      for (const row of specRows) {
        if (/Country\s+of\s+Origin/i.test(row) && !result.countryOfOrigin) {
          const val = row.match(/<td[^>]*>\s*([A-Z]{2,3})\s*<\/td>/i);
          if (val) result.countryOfOrigin = val[1].toUpperCase();
        }
        if (/Country\s+of\s+Assembly/i.test(row) && !result.countryOfAssembly) {
          const val = row.match(/<td[^>]*>\s*([A-Z]{2,3})\s*<\/td>/i);
          if (val) result.countryOfAssembly = val[1].toUpperCase();
        }
        if (/Country\s+of\s+Diffusion/i.test(row) && !result.countryOfDiffusion) {
          const val = row.match(/<td[^>]*>\s*([A-Z]{2,3})\s*<\/td>/i);
          if (val) result.countryOfDiffusion = val[1].toUpperCase();
        }
      }
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("[scrape-part] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
