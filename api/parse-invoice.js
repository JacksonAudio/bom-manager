// Vercel Serverless Function — Parse PDF invoices using Claude AI
// Receives base64-encoded PDF text, sends to Claude for structured extraction
// Returns JSON array of line items: { mpn, description, quantity, unitPrice, extendedPrice }

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { invoiceText, apiKey } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: "Missing Anthropic API key" });
  if (!invoiceText) return res.status(400).json({ error: "Missing invoice text" });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: `You are a parts invoice parser for an electronics manufacturer. Extract all line items from this invoice/packing slip text.

Return ONLY a valid JSON array with no other text. Each item should have these fields:
- "mpn": manufacturer part number (string)
- "description": part description (string)
- "quantity": number of units received (number)
- "unitPrice": price per unit in USD (number, 0 if not listed)
- "extendedPrice": total line price in USD (number, 0 if not listed)
- "supplier": supplier/distributor name if identifiable (string)
- "orderNumber": PO or order number if found (string)

If a field is not available, use empty string for strings and 0 for numbers.
Be thorough — extract every single line item, even if some fields are missing.

Invoice text:
${invoiceText}`
          }
        ]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("Claude API error:", response.status, errBody);
      return res.status(502).json({ error: `Claude API error: ${response.status}`, details: errBody });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";

    // Extract JSON from response (Claude might wrap it in markdown code blocks)
    let items;
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      items = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
    } catch (parseErr) {
      console.error("Failed to parse Claude response:", text);
      return res.status(422).json({ error: "Failed to parse AI response", rawText: text });
    }

    return res.status(200).json({ items, rawResponse: text });
  } catch (err) {
    console.error("parse-invoice error:", err);
    return res.status(500).json({ error: err.message });
  }
}
