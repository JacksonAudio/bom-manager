// ============================================================
// api/scrape-part.js — Extract Country of Origin from distributor pages
//
// Two strategies:
// 1. Mouser Keyword Search API (reliable, structured data)
// 2. HTML scrape fallback for non-Mouser URLs
// ============================================================

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { url, mpn, mouserKey } = req.query;
  if (!url && !mpn) return res.status(400).json({ error: "url or mpn parameter is required" });

  try {
    const result = {};

    // Strategy 1: Use Mouser Keyword Search API (returns COO more reliably than part number search)
    if (mouserKey && mpn) {
      try {
        const mouserRes = await fetch(`https://api.mouser.com/api/v1/search/keyword?apiKey=${encodeURIComponent(mouserKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            SearchByKeywordRequest: {
              keyword: mpn,
              records: 5,
              startingRecord: 0,
              searchOptions: "",
              searchWithYourSignUpLanguage: "",
            },
          }),
        });

        if (mouserRes.ok) {
          const data = await mouserRes.json();
          const parts = data?.SearchResults?.Parts || [];
          // Find exact MPN match
          const mpnUpper = mpn.toUpperCase();
          const match = parts.find(p => (p.ManufacturerPartNumber || "").toUpperCase() === mpnUpper)
            || parts.find(p => (p.ManufacturerPartNumber || "").toUpperCase().includes(mpnUpper))
            || parts[0];

          if (match) {
            if (match.CountryOfOrigin) result.countryOfOrigin = match.CountryOfOrigin.toUpperCase();

            // Check ProductCompliance array
            if (!result.countryOfOrigin && Array.isArray(match.ProductCompliance)) {
              for (const comp of match.ProductCompliance) {
                if (comp.ComplianceName && /country.*origin/i.test(comp.ComplianceName) && comp.ComplianceValue) {
                  result.countryOfOrigin = comp.ComplianceValue.toUpperCase();
                }
                if (comp.ComplianceName && /country.*assembly/i.test(comp.ComplianceName) && comp.ComplianceValue) {
                  result.countryOfAssembly = comp.ComplianceValue.toUpperCase();
                }
                if (comp.ComplianceName && /country.*diffusion/i.test(comp.ComplianceName) && comp.ComplianceValue) {
                  result.countryOfDiffusion = comp.ComplianceValue.toUpperCase();
                }
              }
            }

            // Log what we got for debugging
            console.log("[scrape-part] Mouser keyword search for", mpn, "→ COO:", result.countryOfOrigin || "not found",
              "| Fields present:", Object.keys(match).filter(k => k.toLowerCase().includes("country")).join(", ") || "none",
              "| Compliance:", JSON.stringify(match.ProductCompliance || []).slice(0, 300));

            if (match.ProductDetailUrl) result.url = match.ProductDetailUrl;
          }
        }
      } catch (e) {
        console.warn("[scrape-part] Mouser keyword search failed:", e.message);
      }
    }

    // Strategy 2: If we still don't have COO and have a URL, try scraping the page
    if (!result.countryOfOrigin && url) {
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();

        // Only allow known distributor domains
        const allowed = ["mouser.com", "digikey.com", "arrow.com", "lcsc.com"];
        if (!allowed.some(d => host.includes(d))) {
          if (!Object.keys(result).length) {
            return res.status(400).json({ error: "Unsupported distributor domain" });
          }
        } else {
          const response = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
              "Accept-Encoding": "identity",
              "Cache-Control": "no-cache",
              "Sec-Fetch-Dest": "document",
              "Sec-Fetch-Mode": "navigate",
              "Sec-Fetch-Site": "none",
              "Sec-Fetch-User": "?1",
              "Upgrade-Insecure-Requests": "1",
            },
            redirect: "follow",
          });

          if (response.ok) {
            const html = await response.text();
            console.log("[scrape-part] Page fetched, length:", html.length, "| Contains 'Country of Origin':", html.includes("Country of Origin"));

            // Very broad regex patterns to catch any HTML structure
            // Pattern: "Country of Origin" followed eventually by a 2-letter code
            if (!result.countryOfOrigin) {
              const m = html.match(/Country\s+of\s+Origin[\s\S]{0,200}?([A-Z]{2})(?=[\s<",.])/i);
              if (m) result.countryOfOrigin = m[1].toUpperCase();
            }
            if (!result.countryOfAssembly) {
              const m = html.match(/Country\s+of\s+Assembly[\s\S]{0,200}?([A-Z]{2})(?=[\s<",.])/i);
              if (m) result.countryOfAssembly = m[1].toUpperCase();
            }
            if (!result.countryOfDiffusion) {
              const m = html.match(/Country\s+of\s+Diffusion[\s\S]{0,200}?([A-Z]{2})(?=[\s<",.])/i);
              if (m) result.countryOfDiffusion = m[1].toUpperCase();
            }

            // JSON embedded in page (React state, Next.js data, etc.)
            const jsonMatches = html.match(/"countryOfOrigin"\s*:\s*"([^"]{2,3})"/gi);
            if (jsonMatches && !result.countryOfOrigin) {
              const val = jsonMatches[0].match(/"([^"]{2,3})"$/);
              if (val) result.countryOfOrigin = val[1].toUpperCase();
            }
          } else {
            console.warn("[scrape-part] Page fetch failed:", response.status);
          }
        }
      } catch (e) {
        console.warn("[scrape-part] HTML scrape failed:", e.message);
      }
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("[scrape-part] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
