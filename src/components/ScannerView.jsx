// ============================================================
// src/components/ScannerView.jsx
// Camera-based QR/barcode scanner for stock updates
// ============================================================

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'

export default function ScannerView({ parts, products, updatePart, darkMode }) {
  const bg = darkMode ? '#1c1c1e' : '#fff'
  const border = darkMode ? '#3a3a3e' : '#e5e5ea'
  const borderLight = darkMode ? '#2c2c2e' : '#f0f0f2'
  const text = darkMode ? '#f5f5f7' : '#1d1d1f'
  const textSub = darkMode ? '#98989d' : '#86868b'
  const textMuted = darkMode ? '#636366' : '#aeaeb2'
  const inputBorder = darkMode ? '#3a3a3e' : '#d2d2d7'
  const hoverBg = darkMode ? '#2c2c2e' : '#f5f5f7'

  const [scanning, setScanning]     = useState(false)
  const [scannedPart, setScannedPart] = useState(null)
  const [scanError, setScanError]   = useState('')
  const [action, setAction]         = useState('add')
  const [qty, setQty]               = useState('')
  const [updating, setUpdating]     = useState(false)
  const [history, setHistory]       = useState([])
  const [cameraError, setCameraError] = useState('')
  const scannerRef  = useRef(null)
  const readerRef   = useRef(null)
  const lastScanRef = useRef('')

  // O(1) lookup maps
  const partsById  = useMemo(() => new Map(parts.map(p => [p.id, p])), [parts])
  const partsByMpn = useMemo(() => {
    const m = new Map()
    for (const p of parts) {
      if (p.mpn) m.set(p.mpn.toLowerCase(), p)
    }
    return m
  }, [parts])

  const getProductName = useCallback((projectId) => {
    if (!projectId) return null
    const prod = products.find(p => p.id === projectId)
    return prod ? prod.name : null
  }, [products])

  // Handle decoded scan result
  const handleScan = useCallback((decodedText) => {
    if (decodedText === lastScanRef.current) return
    lastScanRef.current = decodedText
    setTimeout(() => { lastScanRef.current = '' }, 2000)

    setScanError('')
    setScannedPart(null)
    setQty('')

    let matched = null
    try {
      const data = JSON.parse(decodedText)
      if (data.id) matched = partsById.get(data.id) || null
      if (!matched && data.mpn) matched = partsByMpn.get(data.mpn.toLowerCase()) || null
    } catch {
      // Not JSON — treat as raw MPN/barcode string
    }

    if (!matched) {
      const raw = decodedText.trim().toLowerCase()
      matched = partsByMpn.get(raw) || null
      if (!matched) {
        matched = parts.find(p =>
          (p.mpn && p.mpn.toLowerCase() === raw) ||
          (p.reference && p.reference.toLowerCase() === raw)
        ) || null
      }
    }

    if (matched) {
      setScannedPart(matched)
      if (navigator.vibrate) navigator.vibrate(100)
    } else {
      setScanError(`No matching part found for: "${decodedText.substring(0, 60)}"`)
    }
  }, [partsById, partsByMpn, parts])

  // Start/stop scanner
  useEffect(() => {
    if (!scanning) return
    let html5Qrcode = null

    async function startScanner() {
      try {
        const { Html5Qrcode } = await import('html5-qrcode')
        html5Qrcode = new Html5Qrcode('qr-reader')
        scannerRef.current = html5Qrcode

        await html5Qrcode.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
          (decodedText) => handleScan(decodedText),
          () => {}
        )
        setCameraError('')
      } catch (err) {
        console.error('Scanner start failed:', err)
        setCameraError(
          err.toString().includes('NotAllowed')
            ? 'Camera access denied. Please allow camera permissions and try again.'
            : err.toString().includes('NotFound')
            ? 'No camera found. Connect a camera or try on a mobile device.'
            : `Camera error: ${err.message || err}`
        )
        setScanning(false)
      }
    }

    startScanner()

    return () => {
      if (html5Qrcode) {
        html5Qrcode.stop().catch(() => {})
        html5Qrcode.clear()
      }
      scannerRef.current = null
    }
  }, [scanning, handleScan])

  // Apply stock update
  const applyUpdate = async () => {
    if (!scannedPart || !qty) return
    const qtyNum = parseInt(qty)
    if (isNaN(qtyNum) || qtyNum <= 0) return

    const oldQty = parseInt(scannedPart.stockQty) || 0
    let newQty
    if (action === 'add')    newQty = oldQty + qtyNum
    else if (action === 'remove') newQty = Math.max(0, oldQty - qtyNum)
    else                     newQty = qtyNum

    setUpdating(true)
    try {
      await updatePart(scannedPart.id, 'stockQty', String(newQty))
      const entry = {
        timestamp: new Date(),
        mpn: scannedPart.mpn || scannedPart.reference || '—',
        product: getProductName(scannedPart.projectId),
        action,
        delta: action === 'set' ? null : (action === 'add' ? qtyNum : -qtyNum),
        oldQty,
        newQty,
      }
      setHistory(prev => [entry, ...prev].slice(0, 50))
      setScannedPart(null)
      setQty('')
      setScanError('')
    } catch (e) {
      setScanError('Update failed: ' + e.message)
    } finally {
      setUpdating(false)
    }
  }

  const fmtTime = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <h2 style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif",
        fontSize: 28, fontWeight: 700, letterSpacing: '-0.5px', color: text, marginBottom: 4 }}>
        Scan
      </h2>
      <p style={{ fontSize: 14, color: textSub, marginBottom: 24 }}>
        Scan a QR label or barcode to quickly update stock quantities.
      </p>

      {/* Scanner toggle */}
      <div style={{ marginBottom: 20 }}>
        <button
          onClick={() => { setScanning(!scanning); setScanError(''); setCameraError(''); }}
          style={{ padding: '12px 28px', borderRadius: 980, fontSize: 14, fontWeight: 600,
            cursor: 'pointer', border: 'none',
            background: scanning ? '#ff3b30' : '#0a84ff', color: '#fff',
            fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",
            display: 'flex', alignItems: 'center', gap: 8 }}>
          {scanning ? '■ Stop Scanner' : '📷 Start Scanner'}
        </button>
      </div>

      {/* Camera error */}
      {cameraError && (
        <div style={{ background: darkMode ? '#3a1c1c' : '#fff2f2', border: `1px solid ${darkMode ? '#ff453a' : '#ffccc7'}`,
          borderRadius: 10, padding: '14px 18px', marginBottom: 16, fontSize: 13, color: '#ff453a' }}>
          {cameraError}
        </div>
      )}

      {/* Camera viewfinder */}
      {scanning && (
        <div style={{ background: '#000', borderRadius: 16, overflow: 'hidden', marginBottom: 20,
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
          <div id="qr-reader" ref={readerRef} style={{ width: '100%' }} />
        </div>
      )}

      {/* Scan error */}
      {scanError && (
        <div style={{ background: darkMode ? '#3a2c1c' : '#fff8f0', border: `1px solid ${darkMode ? '#ff9f0a' : '#ffd6a5'}`,
          borderRadius: 10, padding: '14px 18px', marginBottom: 16, fontSize: 13, color: '#ff9f0a' }}>
          {scanError}
        </div>
      )}

      {/* Scanned part + stock update form */}
      {scannedPart && (
        <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 16,
          padding: 24, marginBottom: 20, boxShadow: `0 2px 8px rgba(0,0,0,${darkMode ? 0.3 : 0.06})` }}>
          <div style={{ fontSize: 10, color: '#30d158', fontWeight: 700, letterSpacing: '0.1em',
            marginBottom: 10, textTransform: 'uppercase' }}>
            Part Found
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: text,
            fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>
            {scannedPart.mpn || scannedPart.reference || '—'}
          </div>
          <div style={{ fontSize: 13, color: textSub, marginTop: 4 }}>
            {[scannedPart.description, scannedPart.value, scannedPart.manufacturer].filter(Boolean).join(' — ') || 'No description'}
          </div>
          {getProductName(scannedPart.projectId) && (
            <div style={{ fontSize: 12, color: '#0a84ff', marginTop: 4 }}>
              {getProductName(scannedPart.projectId)}
            </div>
          )}
          <div style={{ fontSize: 14, fontWeight: 600, color: text, marginTop: 12 }}>
            Current Stock: <span style={{ fontSize: 20, fontWeight: 800 }}>{parseInt(scannedPart.stockQty) || 0}</span>
            {scannedPart.reorderQty && (
              <span style={{ fontSize: 12, color: textSub, marginLeft: 8 }}>
                (reorder at {scannedPart.reorderQty})
              </span>
            )}
          </div>

          {/* Action + quantity */}
          <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10, color: textSub, marginBottom: 4, fontWeight: 600, letterSpacing: '0.05em' }}>ACTION</div>
              <select value={action} onChange={e => setAction(e.target.value)}
                style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, border: `1px solid ${inputBorder}`, color: text, background: bg }}>
                <option value="add">Add to Stock</option>
                <option value="remove">Remove from Stock</option>
                <option value="set">Set Stock To</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, color: textSub, marginBottom: 4, fontWeight: 600, letterSpacing: '0.05em' }}>QUANTITY</div>
              <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applyUpdate() }}
                placeholder="0"
                autoFocus
                style={{ padding: '10px 14px', borderRadius: 8, fontSize: 16, fontWeight: 700, width: 100,
                  border: `1px solid ${inputBorder}`, color: text, textAlign: 'center', background: bg }} />
            </div>
            <button onClick={applyUpdate}
              disabled={updating || !qty || parseInt(qty) <= 0}
              style={{ padding: '10px 24px', borderRadius: 980, fontSize: 14, fontWeight: 600,
                cursor: 'pointer', border: 'none', background: '#30d158', color: '#fff',
                opacity: (!qty || parseInt(qty) <= 0) ? 0.4 : 1,
                fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>
              {updating ? 'Updating…' : 'Update Stock'}
            </button>
          </div>

          {/* Preview */}
          {qty && parseInt(qty) > 0 && (
            <div style={{ marginTop: 12, fontSize: 13, color: textSub,
              fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>
              {(() => {
                const old = parseInt(scannedPart.stockQty) || 0
                const q = parseInt(qty)
                const nw = action === 'add' ? old + q : action === 'remove' ? Math.max(0, old - q) : q
                return `${old} → ${nw}`
              })()}
            </div>
          )}
        </div>
      )}

      {/* Manual part lookup */}
      {!scanning && !scannedPart && (
        <ManualLookup parts={parts} products={products} onSelect={setScannedPart}
          bg={bg} border={border} text={text} textSub={textSub} inputBorder={inputBorder} hoverBg={hoverBg} />
      )}

      {/* Scan history */}
      {history.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 10, color: textSub, fontWeight: 700, letterSpacing: '0.1em',
            marginBottom: 10, textTransform: 'uppercase' }}>
            Scan History
          </div>
          <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, overflow: 'hidden' }}>
            {history.map((h, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 16px', borderBottom: i < history.length - 1 ? `1px solid ${borderLight}` : 'none',
                fontSize: 13 }}>
                <span style={{ color: textMuted, fontSize: 11, minWidth: 60 }}>{fmtTime(h.timestamp)}</span>
                <span style={{ fontWeight: 600, color: text, flex: 1 }}>{h.mpn}</span>
                {h.product && <span style={{ fontSize: 11, color: '#0a84ff' }}>{h.product}</span>}
                <span style={{ fontWeight: 700, fontSize: 14,
                  color: h.delta == null ? '#0a84ff' : h.delta > 0 ? '#30d158' : '#ff453a' }}>
                  {h.delta == null ? `= ${h.newQty}` : h.delta > 0 ? `+${h.delta}` : h.delta}
                </span>
                <span style={{ color: textMuted, fontSize: 11 }}>{h.oldQty} → {h.newQty}</span>
              </div>
            ))}
          </div>
          <button onClick={() => setHistory([])}
            style={{ marginTop: 8, background: 'none', border: 'none', fontSize: 11,
              color: textMuted, cursor: 'pointer', padding: '4px 0' }}>
            Clear history
          </button>
        </div>
      )}
    </div>
  )
}

// ── Manual part lookup (for when camera isn't available)
function ManualLookup({ parts, products, onSelect, bg, border, text, textSub, inputBorder, hoverBg }) {
  const [q, setQ] = useState('')
  const matches = q.trim().length >= 2
    ? parts.filter(p => {
        const lq = q.trim().toLowerCase()
        return (p.mpn && p.mpn.toLowerCase().includes(lq)) ||
               (p.reference && p.reference.toLowerCase().includes(lq)) ||
               (p.description && p.description.toLowerCase().includes(lq))
      }).slice(0, 10)
    : []

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 16,
      padding: 20, marginBottom: 20 }}>
      <div style={{ fontSize: 10, color: textSub, fontWeight: 700, letterSpacing: '0.1em',
        marginBottom: 10, textTransform: 'uppercase' }}>
        Manual Lookup
      </div>
      <input type="text" value={q} onChange={e => setQ(e.target.value)}
        placeholder="Search by MPN, reference, or description…"
        style={{ width: '100%', padding: '10px 14px', borderRadius: 8, fontSize: 13,
          border: `1px solid ${inputBorder}`, color: text, background: bg }} />
      {matches.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {matches.map(m => (
            <div key={m.id} onClick={() => { onSelect(m); setQ('') }}
              style={{ padding: '10px 12px', cursor: 'pointer', borderRadius: 8,
                transition: 'background 0.1s' }}
              onMouseOver={e => e.currentTarget.style.background = hoverBg}
              onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
              <div style={{ fontSize: 14, fontWeight: 600, color: text }}>
                {m.mpn || m.reference || '—'}
              </div>
              <div style={{ fontSize: 11, color: textSub, marginTop: 1 }}>
                {[m.value, m.description].filter(Boolean).join(' · ') || 'No details'}
                {m.projectId && (() => {
                  const prod = products.find(x => x.id === m.projectId)
                  return prod ? <span style={{ color: '#0a84ff' }}> — {prod.name}</span> : null
                })()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
