// Vercel Serverless Function — Parse invoices using Claude AI
// Handles PDF, images (screenshots), and text-based invoices

const PROMPT = `You are a parts invoice parser for an electronics manufacturer. Extract all line items from this invoice/packing slip.

Return ONLY a valid JSON array with no other text. Each item should have these fields:
- "mpn": manufacturer part number (string)
- "description": part description (string)
- "quantity": number of units received (number)
- "unitPrice": price per unit in USD (number, 0 if not listed)
- "extendedPrice": total line price in USD (number, 0 if not listed)
- "supplier": supplier/distributor name if identifiable (string)
- "orderNumber": PO or order number if found (string)

If a field is not available, use empty string for strings and 0 for numbers.
Be thorough — extract every single line item, even if some fields are missing.`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { invoiceText, fileBase64, pdfBase64, mediaType, apiKey } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: "Missing Anthropic API key" });
  if (!invoiceText && !fileBase64 && !pdfBase64) return res.status(400).json({ error: "Missing invoice data" });

  // Support legacy pdfBase64 field
  const base64Data = fileBase64 || pdfBase64;
  const mimeType = mediaType || "application/pdf";

  try {
    let content;
    if (base64Data) {
      const isPDF = mimeType === "application/pdf";
      if (isPDF) {
        content = [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } },
          { type: "text", text: PROMPT },
        ];
      } else {
        // Image — use vision
        content = [
          { type: "image", source: { type: "base64", media_type: mimeType, data: base64Data } },
          { type: "text", text: PROMPT },
        ];
      }
    } else {
      content = PROMPT + "\n\nInvoice text:\n" + invoiceText;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdfs-2025-06-09",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("Claude API error:", response.status, errBody);
      return res.status(502).json({ error: `Claude API error: ${response.status}`, details: errBody });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";

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
