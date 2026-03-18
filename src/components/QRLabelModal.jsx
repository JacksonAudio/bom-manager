// ============================================================
// src/components/QRLabelModal.jsx
// QR code label generator for parts — print-ready labels
// ============================================================

import { useState, useEffect } from 'react'
import QRCode from 'qrcode'

export default function QRLabelModal({ parts, products, onClose }) {
  const [qrImages, setQrImages] = useState({})
  const [labelSize, setLabelSize] = useState('medium')

  const sizes = {
    small:  { qr: 80,  font: 10, pad: 8,  cols: 4 },
    medium: { qr: 120, font: 12, pad: 12, cols: 3 },
    large:  { qr: 160, font: 14, pad: 16, cols: 2 },
  }
  const sz = sizes[labelSize]

  useEffect(() => {
    let cancelled = false
    async function gen() {
      const imgs = {}
      for (const p of parts) {
        const payload = JSON.stringify({ id: p.id, mpn: p.mpn || '', ref: p.reference || '', v: '1.0' })
        try {
          imgs[p.id] = await QRCode.toDataURL(payload, {
            width: sz.qr * 2, margin: 1, errorCorrectionLevel: 'M',
            color: { dark: '#1d1d1f', light: '#ffffff' },
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
    // Open a new window with just the labels for clean printing
    const printWin = window.open('', '_blank', 'width=800,height=600')
    const labelsHtml = parts.map(part => {
      const img = qrImages[part.id] || ''
      const prodName = getProductName(part.projectId)
      return `
        <div style="border:1px solid #ccc;border-radius:8px;padding:${sz.pad}px;display:flex;flex-direction:column;align-items:center;gap:6px;break-inside:avoid">
          ${img ? `<img src="${img}" width="${sz.qr}" height="${sz.qr}" />` : '<div style="width:80px;height:80px;background:#eee"></div>'}
          <div style="text-align:center;width:100%">
            <div style="font-size:${sz.font}px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${part.mpn || part.reference || '—'}</div>
            ${part.value ? `<div style="font-size:${sz.font - 2}px;color:#666;margin-top:2px">${part.value}</div>` : ''}
            ${part.description ? `<div style="font-size:${sz.font - 3}px;color:#999;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${part.description}</div>` : ''}
            ${prodName ? `<div style="font-size:${sz.font - 3}px;color:#0071e3;margin-top:2px">${prodName}</div>` : ''}
          </div>
        </div>`
    }).join('')

    printWin.document.write(`<!DOCTYPE html><html><head><title>QR Labels</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif; padding: 16px; }
        .grid { display: grid; grid-template-columns: repeat(${sz.cols}, 1fr); gap: 12px; }
      </style></head><body>
      <div class="grid">${labelsHtml}</div>
      <script>window.onload = function() { window.print(); }</script>
      </body></html>`)
    printWin.document.close()
  }

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
              {parts.length} label{parts.length !== 1 ? 's' : ''} — scan with Scan In to update stock
            </div>
          </div>
          <div style={{ display:'flex',gap:8,alignItems:'center' }}>
            <select value={labelSize} onChange={e => setLabelSize(e.target.value)}
              style={{ padding:'6px 10px',borderRadius:6,fontSize:12,border:'1px solid #d2d2d7',color:'#1d1d1f' }}>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
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

        {/* Labels grid preview */}
        <div style={{ flex:1,overflowY:'auto',padding:24 }}>
          <div style={{ display:'grid',gridTemplateColumns:`repeat(${sz.cols}, 1fr)`,gap:16 }}>
            {parts.map(part => (
              <div key={part.id} style={{ border:'1px solid #e5e5ea',borderRadius:10,padding:sz.pad,
                display:'flex',flexDirection:'column',alignItems:'center',gap:8,background:'#fff' }}>
                {qrImages[part.id] ? (
                  <img src={qrImages[part.id]} alt={part.mpn} style={{ width:sz.qr,height:sz.qr }} />
                ) : (
                  <div style={{ width:sz.qr,height:sz.qr,background:'#f5f5f7',borderRadius:8,
                    display:'flex',alignItems:'center',justifyContent:'center',color:'#aeaeb2',fontSize:11 }}>
                    Loading…
                  </div>
                )}
                <div style={{ textAlign:'center',width:'100%' }}>
                  <div style={{ fontSize:sz.font,fontWeight:700,color:'#1d1d1f',
                    fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",
                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                    {part.mpn || part.reference || '—'}
                  </div>
                  {part.value && (
                    <div style={{ fontSize:sz.font - 2,color:'#86868b',marginTop:2 }}>{part.value}</div>
                  )}
                  {part.description && (
                    <div style={{ fontSize:sz.font - 3,color:'#aeaeb2',marginTop:1,
                      overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                      {part.description}
                    </div>
                  )}
                  {getProductName(part.projectId) && (
                    <div style={{ fontSize:sz.font - 3,color:'#0071e3',marginTop:2 }}>
                      {getProductName(part.projectId)}
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
