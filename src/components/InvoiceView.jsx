// ============================================================
// src/components/InvoiceView.jsx — Mobile Invoice Scanner
// Phone-optimized view for receiving/warehouse staff
// ============================================================

import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase.js";

const FONT = "'IBM Plex Sans',system-ui,sans-serif";

export default function InvoiceView() {
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Capture state
  const [capturing, setCapturing] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);

  // Fetch Anthropic API key on mount
  useEffect(() => {
    (async () => {
      try {
        const { data, error: fetchErr } = await supabase
          .from("api_keys")
          .select("key_name, key_value")
          .eq("key_name", "anthropic_api_key");
        if (fetchErr) {
          setError("Cannot load API key: " + fetchErr.message);
          setLoading(false);
          return;
        }
        const row = (data || []).find((r) => r.key_name === "anthropic_api_key");
        if (row && row.key_value) {
          setApiKey(row.key_value);
        } else {
          setError("No Anthropic API key configured. Add it in Settings.");
        }
      } catch (e) {
        setError("Failed to load API key: " + e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => stopCamera();
  }, []);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCapturing(false);
  };

  const startCamera = async () => {
    setError("");
    setResult(null);
    setSavedCount(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      setCapturing(true);
      // Wait for DOM update then attach stream
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      }, 50);
    } catch (e) {
      setError("Camera access denied: " + e.message);
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    stopCamera();
    const base64 = dataUrl.split(",")[1];
    sendToParser(base64, "image/jpeg");
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    setResult(null);
    setSavedCount(null);
    setError("");

    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target.result.split(",")[1];
      const ext = file.name.toLowerCase().split(".").pop();
      const isPDF = ext === "pdf";
      const mediaType = isPDF ? "application/pdf" : file.type || `image/${ext === "jpg" ? "jpeg" : ext}`;
      sendToParser(base64, mediaType);
    };
    reader.readAsDataURL(file);
  };

  const sendToParser = async (fileBase64, mediaType) => {
    if (!apiKey) {
      setError("No Anthropic API key configured.");
      return;
    }
    setParsing(true);
    setError("");
    try {
      const res = await fetch("/api/parse-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64, mediaType, apiKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Parse failed");
      if (!data.items?.length) throw new Error("No line items found in invoice");
      setResult(data);
    } catch (e) {
      setError("Parsing failed: " + e.message);
    } finally {
      setParsing(false);
    }
  };

  const handleSaveAll = async () => {
    if (!result?.items?.length) return;
    setSaving(true);
    setError("");
    let count = 0;
    try {
      for (const item of result.items) {
        // Try to find existing part by MPN
        const { data: existing } = await supabase
          .from("parts")
          .select("id, stockQty")
          .ilike("mpn", item.mpn || "")
          .limit(1);

        if (existing && existing.length > 0) {
          // Update stock
          const oldStock = parseInt(existing[0].stockQty) || 0;
          const newStock = oldStock + (parseInt(item.quantity) || 0);
          await supabase
            .from("parts")
            .update({ stockQty: String(newStock), unitCost: item.unitPrice > 0 ? String(item.unitPrice) : undefined })
            .eq("id", existing[0].id);
        } else {
          // Create new part
          await supabase.from("parts").insert({
            mpn: item.mpn || "",
            reference: item.mpn || "",
            description: item.description || "",
            manufacturer: item.manufacturer || "",
            unitCost: item.unitPrice > 0 ? String(item.unitPrice) : "",
            stockQty: String(item.quantity || 0),
            minStock: "0",
          });
        }
        count++;
      }
      setSavedCount(count);
      setResult(null);
    } catch (e) {
      setError("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Loading
  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.centered}>
          <div style={{ fontSize: 18, color: "#64748d", fontFamily: FONT }}>Loading...</div>
        </div>
      </div>
    );
  }

  // ── Camera capture mode
  if (capturing) {
    return (
      <div style={styles.container}>
        <div style={{ position: "relative", width: "100%", maxWidth: 480, margin: "0 auto" }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ width: "100%", display: "block", borderRadius: 0 }}
          />
          <canvas ref={canvasRef} style={{ display: "none" }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "20px 16px", display: "flex", gap: 12, background: "linear-gradient(transparent, rgba(0,0,0,0.8))" }}>
            <button onClick={stopCamera} style={{ ...styles.actionBtn, background: "#1f2530", flex: 1 }}>
              Cancel
            </button>
            <button onClick={capturePhoto} style={{ ...styles.actionBtn, background: "#ff453a", flex: 2 }}>
              Capture
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={{ padding: "24px 16px", maxWidth: 480, margin: "0 auto" }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: "#f6f9fc", fontFamily: FONT, textAlign: "center", marginTop: 20, marginBottom: 8 }}>
          Invoice Scanner
        </h1>
        <p style={{ color: "#64748d", fontFamily: FONT, fontSize: 14, textAlign: "center", marginBottom: 28 }}>
          Upload or photograph a supplier invoice
        </p>

        {error && (
          <div style={{ color: "#ff453a", fontSize: 14, fontFamily: FONT, marginBottom: 16, padding: "12px 14px", background: "#0f1218", borderRadius: 12, textAlign: "center" }}>
            {error}
          </div>
        )}

        {savedCount !== null && (
          <div style={{ color: "#34c759", fontSize: 16, fontWeight: 700, fontFamily: FONT, marginBottom: 20, padding: "16px", background: "#0f1218", borderRadius: 12, textAlign: "center" }}>
            Saved {savedCount} items to inventory
          </div>
        )}

        {/* ── Parsing spinner */}
        {parsing && (
          <div style={{ textAlign: "center", marginTop: 40, marginBottom: 40 }}>
            <div style={{ fontSize: 40, marginBottom: 16, animation: "spin 1s linear infinite" }}>&#8987;</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "#f6f9fc", fontFamily: FONT }}>Parsing invoice...</div>
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* ── Results */}
        {result && result.items && !parsing && (
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#f6f9fc", fontFamily: FONT, marginBottom: 14 }}>
              Found {result.items.length} items
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              {result.items.map((item, i) => (
                <div key={i} style={styles.itemCard}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#f6f9fc", fontFamily: FONT, marginBottom: 4 }}>
                    {item.mpn || "No MPN"}
                  </div>
                  {item.description && (
                    <div style={{ fontSize: 12, color: "#64748d", fontFamily: FONT, marginBottom: 6 }}>
                      {item.description}
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontFamily: FONT }}>
                    <span style={{ color: "#8898aa" }}>Qty: <b style={{ color: "#f6f9fc" }}>{item.quantity}</b></span>
                    {item.unitPrice > 0 && (
                      <span style={{ color: "#8898aa" }}>
                        ${typeof item.unitPrice === "number" ? item.unitPrice.toFixed(4) : item.unitPrice} ea
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={handleSaveAll}
              disabled={saving}
              style={{
                width: "100%", padding: "18px 24px", borderRadius: 16, border: "none",
                background: saving ? "#161a22" : "#34c759", color: "#fff",
                fontSize: 18, fontWeight: 800, fontFamily: FONT, cursor: saving ? "default" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Saving..." : "Save All to Inventory"}
            </button>
          </div>
        )}

        {/* ── Upload/Capture buttons (show when no result and not parsing) */}
        {!result && !parsing && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
            <label style={styles.bigButton}>
              Upload File
              <span style={{ fontSize: 13, color: "#64748d", marginTop: 4, fontWeight: 400 }}>PDF, CSV, or image</span>
              <input
                type="file"
                accept=".pdf,.csv,.txt,.tsv,.png,.jpg,.jpeg,.gif,.webp,image/*"
                style={{ display: "none" }}
                onChange={handleFileUpload}
              />
            </label>

            <button onClick={startCamera} style={styles.bigButton}>
              Take Photo
              <span style={{ fontSize: 13, color: "#64748d", marginTop: 4, fontWeight: 400 }}>Opens rear camera</span>
            </button>
          </div>
        )}

        {/* ── New scan button after results */}
        {(result || savedCount !== null) && !parsing && (
          <button
            onClick={() => { setResult(null); setSavedCount(null); setError(""); }}
            style={{ width: "100%", padding: "14px", borderRadius: 12, border: "1px solid #1f2530", background: "transparent", color: "#64748d", fontSize: 15, fontWeight: 600, fontFamily: FONT, cursor: "pointer", marginTop: 14 }}
          >
            Scan Another Invoice
          </button>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    background: "#0a0a0f",
    fontFamily: FONT,
    WebkitTapHighlightColor: "transparent",
  },
  centered: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  bigButton: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "28px 24px",
    borderRadius: 16,
    border: "1px solid #1f2530",
    background: "#0f1218",
    color: "#f6f9fc",
    fontFamily: FONT,
    fontSize: 20,
    fontWeight: 700,
    cursor: "pointer",
    minHeight: 100,
    WebkitTapHighlightColor: "transparent",
  },
  actionBtn: {
    padding: "16px 24px",
    borderRadius: 14,
    border: "none",
    color: "#fff",
    fontSize: 18,
    fontWeight: 700,
    fontFamily: FONT,
    cursor: "pointer",
  },
  itemCard: {
    background: "#0f1218",
    borderRadius: 12,
    padding: "14px 16px",
    border: "1px solid #161a22",
  },
};
