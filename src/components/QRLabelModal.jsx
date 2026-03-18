// ============================================================
// src/components/QRLabelModal.jsx
// QR code label generator — formatted for Avery label sheets
// ============================================================

import { useState, useEffect } from 'react'
import QRCode from 'qrcode'

const LABEL_SIZES = {
  '5167': { name: '5167 — ½" × 1¾" (80/sheet)', width: 1.75, height: 0.5, cols: 4, rows: 20, qr: 36, font: 6, marginTop: 0.5, marginLeft: 0.3, gapX: 0.3, gapY: 0 },
  '5160': { name: '5160 — 1" × 2⅝" (30/sheet)', width: 2.625, height: 1, cols: 3, rows: 10, qr: 65, font: 8, marginTop: 0.5, marginLeft: 0.19, gapX: 0.125, gapY: 0 },
  '5163': { name: '5163 — 2" × 4" (10/sheet)', width: 4, height: 2, cols: 2, rows: 5, qr: 120, font: 11, marginTop: 0.5, marginLeft: 0.16, gapX: 0.19, gapY: 0 },
}

export default function QRLabelModal({ parts, products, onClose }) {
  const [qrImages, setQrImages] = useState({})
  const [labelSize, setLabelSize] = useState('5160')
  const sz = LABEL_SIZES[labelSize]

  useEffect(() => {
    let cancelled = false
    async function gen() {
      const imgs = {}
      for (const p of parts) {
        const payload = JSON.stringify({ id: p.id, mpn: p.mpn || '', ref: p.reference || '', v: '1.0' })
        try {
          imgs[p.id] = await QRCode.toDataURL(payload, {
            width: sz.qr * 3, margin: 1, errorCorrectionLevel: 'M',
            color: { dark: '#000000', light: '#ffffff' },
          })
        } catch (e) {
          console.error('QR generation failed for', p.mpn, e)
        }
      }
      if (!cancelled) setQrImages(imgs)
    }
    gen()
    return () => { cancelled = true }
  }, [parts, sz.qr])

  const getProductName = (projectId) => {
    if (!projectId) return null
    const prod = products.find(p => p.id === projectId)
    return prod ? prod.name : null
  }

  const handlePrint = () => {
    const printWin = window.open('', '_blank', 'width=850,height=1100')

    const labelsHtml = parts.map(part => {
      const img = qrImages[part.id] || ''
      const prodName = getProductName(part.projectId)
      const isSmall = labelSize === '5167'

      if (isSmall) {
        // Tiny label — QR left, text right, single line
        return `<div class="label" style="display:flex;align-items:center;gap:3px;overflow:hidden">
          ${img ? `<img src="${img}" style="width:${sz.qr}px;height:${sz.qr}px;flex-shrink:0" />` : ''}
          <div style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:${sz.font}px;font-weight:700">${part.mpn || part.reference || '—'}</div>
        </div>`
      }

      // Normal label — QR left, text right
      return `<div class="label" style="display:flex;align-items:center;gap:${labelSize === '5163' ? 10 : 6}px;overflow:hidden">
        ${img ? `<img src="${img}" style="width:${sz.qr}px;height:${sz.qr}px;flex-shrink:0" />` : ''}
        <div style="overflow:hidden;min-width:0">
          <div style="font-size:${sz.font}px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${part.mpn || part.reference || '—'}</div>
          ${part.value ? `<div style="font-size:${Math.max(sz.font - 2, 5)}px;color:#444;margin-top:1px">${part.value}</div>` : ''}
          ${part.description && labelSize !== '5167' ? `<div style="font-size:${Math.max(sz.font - 2, 5)}px;color:#888;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${part.description}</div>` : ''}
          ${prodName && labelSize === '5163' ? `<div style="font-size:${sz.font - 2}px;color:#0071e3;margin-top:1px">${prodName}</div>` : ''}
        </div>
      </div>`
    }).join('')

    printWin.document.write(`<!DOCTYPE html><html><head><title>QR Labels — Avery ${labelSize}</title>
      <style>
        @page { margin: 0; size: letter; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif; }
        .sheet {
          width: 8.5in;
          padding-top: ${sz.marginTop}in;
          padding-left: ${sz.marginLeft}in;
          display: flex;
          flex-wrap: wrap;
        }
        .label {
          width: ${sz.width}in;
          height: ${sz.height}in;
          padding: 2px 4px;
          overflow: hidden;
          margin-right: ${sz.gapX}in;
          margin-bottom: ${sz.gapY}in;
        }
        img { image-rendering: pixelated; }
      </style></head><body>
      <div class="sheet">${labelsHtml}</div>
      <script>window.onload = function() { setTimeout(function() { window.print(); }, 300); }</script>
      </body></html>`)
    printWin.document.close()
  }

  // Preview grid columns based on label size
  const previewCols = sz.cols

  return (
    <div style={{ position:'fixed',inset:0,zIndex:9999,display:'flex',alignItems:'center',
      justifyContent:'center',background:'rgba(0,0,0,0.5)',padding:20 }}
      onClick={onClose}>
      <div style={{ background:'#fff',borderRadius:16,maxWidth:900,width:'100%',maxHeight:'90vh',
        overflow:'hidden',display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:'20px 24px',borderBottom:'1px solid #e5e5ea',display:'flex',
          alignItems:'center',justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:18,fontWeight:700,color:'#1d1d1f',
              fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>
              QR Labels
            </div>
            <div style={{ fontSize:12,color:'#86868b',marginTop:2 }}>
              {parts.length} label{parts.length !== 1 ? 's' : ''} — select your Avery label sheet
            </div>
          </div>
          <div style={{ display:'flex',gap:8,alignItems:'center' }}>
            <select value={labelSize} onChange={e => setLabelSize(e.target.value)}
              style={{ padding:'6px 10px',borderRadius:6,fontSize:12,border:'1px solid #d2d2d7',color:'#1d1d1f',minWidth:200 }}>
              {Object.entries(LABEL_SIZES).map(([key, val]) => (
                <option key={key} value={key}>{val.name}</option>
              ))}
            </select>
            <button onClick={handlePrint}
              disabled={Object.keys(qrImages).length === 0}
              style={{ padding:'8px 18px',borderRadius:980,fontSize:13,fontWeight:600,cursor:'pointer',
                border:'none',background:'#0071e3',color:'#fff',
                opacity: Object.keys(qrImages).length === 0 ? 0.4 : 1,
                fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>
              Print Labels
            </button>
            <button onClick={onClose}
              style={{ background:'none',border:'none',fontSize:18,cursor:'pointer',color:'#86868b',
                padding:'4px 8px' }}>
              ✕
            </button>
          </div>
        </div>

        {/* Labels preview */}
        <div style={{ flex:1,overflowY:'auto',padding:24,background:'#f5f5f7' }}>
          <div style={{ display:'grid',gridTemplateColumns:`repeat(${previewCols}, 1fr)`,gap:8 }}>
            {parts.map(part => (
              <div key={part.id} style={{ border:'1px solid #d2d2d7',borderRadius:6,padding:sz.qr > 60 ? 8 : 4,
                display:'flex',alignItems:'center',gap:sz.qr > 60 ? 8 : 4,background:'#fff',
                minHeight: labelSize === '5167' ? 32 : labelSize === '5160' ? 60 : 100 }}>
                {qrImages[part.id] ? (
                  <img src={qrImages[part.id]} alt={part.mpn}
                    style={{ width: Math.min(sz.qr, labelSize === '5167' ? 28 : 60), height: Math.min(sz.qr, labelSize === '5167' ? 28 : 60), flexShrink:0 }} />
                ) : (
                  <div style={{ width:sz.qr > 60 ? 50 : 28,height:sz.qr > 60 ? 50 : 28,background:'#f0f0f2',borderRadius:4,flexShrink:0 }} />
                )}
                <div style={{ overflow:'hidden',minWidth:0 }}>
                  <div style={{ fontSize: labelSize === '5167' ? 9 : 12, fontWeight:700,color:'#1d1d1f',
                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                    {part.mpn || part.reference || '—'}
                  </div>
                  {labelSize !== '5167' && part.value && (
                    <div style={{ fontSize:10,color:'#86868b',marginTop:1 }}>{part.value}</div>
                  )}
                  {labelSize === '5163' && part.description && (
                    <div style={{ fontSize:9,color:'#aeaeb2',marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                      {part.description}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
