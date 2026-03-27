// ============================================================
// src/components/StickerPrintModal.jsx
// Serial number sticker generator for pedal bottoms
// Supports Jackson Audio and Fulltone USA branding
// QR code links to product registration page
// Formatted for Zebra thermal transfer / metallic label printers
// ============================================================

import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import { renderStickerHTML } from './StickerEditor.jsx'

const STICKER_SIZES = {
  '2x1':   { name: '2" × 1" (standard pedal)', width: 2, height: 1, qr: 70, fontSN: 11, fontProd: 9, fontBrand: 8 },
  '2.5x1': { name: '2.5" × 1" (large pedal)',  width: 2.5, height: 1, qr: 75, fontSN: 12, fontProd: 10, fontBrand: 9 },
  '3x1.5': { name: '3" × 1.5" (rack unit)',     width: 3, height: 1.5, qr: 100, fontSN: 14, fontProd: 12, fontBrand: 11 },
  '2x0.75':{ name: '2" × ¾" (mini pedal)',      width: 2, height: 0.75, qr: 50, fontSN: 9, fontProd: 7, fontBrand: 7 },
}

// Registration URL uses the app's own #register page
// The QR code links to: {appUrl}#register?sn=XXX&product=YYY&brand=ZZZ
const getRegUrl = () => {
  const base = window.location.origin + window.location.pathname
  return base
}

const BRAND_CONFIG = {
  'Jackson Audio': {
    logo: 'JACKSON AUDIO',
    tagline: 'jacksonaudio.com',
    accentColor: '#c8a84e',
    textColor: '#1a1a1a',
    bgColor: '#f5f5f5',
  },
  'Fulltone USA': {
    logo: 'FULLTONE USA',
    tagline: 'fulltone.com',
    accentColor: '#b22222',
    textColor: '#1a1a1a',
    bgColor: '#f5f5f5',
  },
}

export default function StickerPrintModal({ units, products, playTesters, teamMembers, stickerTemplate, onClose }) {
  const [qrImages, setQrImages] = useState({})
  const [stickerSize, setStickerSize] = useState(stickerTemplate?.stickerSize || '2x1')
  const [selectedUnits, setSelectedUnits] = useState(new Set(units.map(u => u.id)))
  const sz = STICKER_SIZES[stickerSize]
  const hasCustomTemplate = !!(stickerTemplate?.elements)

  useEffect(() => {
    let cancelled = false
    async function gen() {
      const imgs = {}
      for (const unit of units) {
        const prod = products.find(p => p.id === unit.product_id)
        const brand = prod?.brand || 'Jackson Audio'
        const cfg = BRAND_CONFIG[brand] || BRAND_CONFIG['Jackson Audio']
        // QR payload: registration URL with serial number, product, and brand
        const regUrl = `${getRegUrl()}#register?sn=${encodeURIComponent(unit.serial_number)}&product=${encodeURIComponent(prod?.name || '')}&brand=${encodeURIComponent(brand)}`
        try {
          imgs[unit.id] = await QRCode.toDataURL(regUrl, {
            width: sz.qr * 3, margin: 1, errorCorrectionLevel: 'M',
            color: { dark: '#000000', light: '#ffffff' },
          })
        } catch (e) {
          console.error('QR generation failed for', unit.serial_number, e)
        }
      }
      if (!cancelled) setQrImages(imgs)
    }
    gen()
    return () => { cancelled = true }
  }, [units, products, sz.qr])

  const toggleUnit = (id) => {
    setSelectedUnits(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedUnits.size === units.length) setSelectedUnits(new Set())
    else setSelectedUnits(new Set(units.map(u => u.id)))
  }

  const handlePrint = () => {
    const printUnits = units.filter(u => selectedUnits.has(u.id))
    if (printUnits.length === 0) return

    const printWin = window.open('', '_blank', 'width=850,height=1100')

    const stickersHtml = printUnits.map(unit => {
      const prod = products.find(p => p.id === unit.product_id)
      const brand = prod?.brand || 'Jackson Audio'
      const cfg = BRAND_CONFIG[brand] || BRAND_CONFIG['Jackson Audio']
      const qr = qrImages[unit.id] || ''

      // Use custom template from sticker editor if available
      if (hasCustomTemplate) {
        return renderStickerHTML(stickerTemplate.elements, sz, stickerTemplate.bgColor || '#f5f5f5', stickerTemplate.borderColor || '#cccccc', qr, {
          serial: unit.serial_number,
          product: prod?.name || 'Product',
          brand: cfg.logo,
          tagline: cfg.tagline,
        })
      }

      return `<div class="sticker" style="width:${sz.width}in;height:${sz.height}in;display:flex;align-items:center;padding:4px 8px;gap:6px;border:0.5px solid #ccc;page-break-inside:avoid;box-sizing:border-box;overflow:hidden">
        ${qr ? `<img src="${qr}" style="width:${sz.qr}px;height:${sz.qr}px;flex-shrink:0;image-rendering:pixelated" />` : ''}
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;line-height:1.3">
          <div style="font-size:${sz.fontBrand}px;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;color:${cfg.accentColor};margin-bottom:1px">${cfg.logo}</div>
          <div style="font-size:${sz.fontProd}px;font-weight:700;color:#1a1a1a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${prod?.name || 'Product'}</div>
          <div style="font-size:${sz.fontSN}px;font-weight:800;font-family:'SF Mono',Menlo,monospace;color:#1a1a1a;letter-spacing:0.04em;margin-top:1px">S/N ${unit.serial_number}</div>
          <div style="font-size:${Math.max(sz.fontBrand - 2, 5)}px;color:#888;margin-top:1px">Scan QR to register · ${cfg.tagline}</div>
        </div>
      </div>`
    }).join('')

    printWin.document.write(`<!DOCTYPE html><html><head><title>Serial Number Stickers</title>
      <style>
        @page { margin: 0.25in; size: letter; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif; }
        .sheet { display: flex; flex-wrap: wrap; gap: 2px; }
        img { image-rendering: pixelated; }
        @media print { .sticker { border: none !important; } }
      </style></head><body>
      <div class="sheet">${stickersHtml}</div>
      <script>window.onload = function() { setTimeout(function() { window.print(); }, 400); }<\/script>
      </body></html>`)
    printWin.document.close()
  }

  return (
    <div style={{ position:'fixed',inset:0,zIndex:9999,display:'flex',alignItems:'center',
      justifyContent:'center',background:'rgba(0,0,0,0.5)',padding:20 }}
      onClick={onClose}>
      <div style={{ background:'#fff',borderRadius:16,maxWidth:950,width:'100%',maxHeight:'90vh',
        overflow:'hidden',display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:'20px 24px',borderBottom:'1px solid #e5e5ea',display:'flex',
          alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10 }}>
          <div>
            <div style={{ fontSize:18,fontWeight:700,color:'#1d1d1f',
              fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>
              Serial Number Stickers
            </div>
            <div style={{ fontSize:12,color:'#86868b',marginTop:2 }}>
              {selectedUnits.size} of {units.length} selected — QR codes link to product registration
            </div>
          </div>
          <div style={{ display:'flex',gap:8,alignItems:'center' }}>
            <select value={stickerSize} onChange={e => setStickerSize(e.target.value)}
              style={{ padding:'6px 10px',borderRadius:6,fontSize:12,border:'1px solid #d2d2d7',color:'#1d1d1f',minWidth:180 }}>
              {Object.entries(STICKER_SIZES).map(([key, val]) => (
                <option key={key} value={key}>{val.name}</option>
              ))}
            </select>
            <button onClick={toggleAll}
              style={{ padding:'6px 14px',borderRadius:980,fontSize:11,fontWeight:600,cursor:'pointer',
                border:'none',background:'#f0f0f2',color:'#1d1d1f' }}>
              {selectedUnits.size === units.length ? 'Deselect All' : 'Select All'}
            </button>
            <button onClick={handlePrint}
              disabled={selectedUnits.size === 0}
              style={{ padding:'8px 18px',borderRadius:980,fontSize:13,fontWeight:600,cursor:'pointer',
                border:'none',background:'#0071e3',color:'#fff',
                opacity: selectedUnits.size === 0 ? 0.4 : 1 }}>
              Print {selectedUnits.size} Sticker{selectedUnits.size !== 1 ? 's' : ''}
            </button>
            <button onClick={onClose}
              style={{ background:'none',border:'none',fontSize:18,cursor:'pointer',color:'#86868b',padding:'4px 8px' }}>
              ✕
            </button>
          </div>
        </div>

        {/* Sticker preview */}
        <div style={{ flex:1,overflowY:'auto',padding:24,background:'#f5f5f7' }}>
          <div style={{ display:'flex',flexWrap:'wrap',gap:10 }}>
            {units.map(unit => {
              const prod = products.find(p => p.id === unit.product_id)
              const brand = prod?.brand || 'Jackson Audio'
              const cfg = BRAND_CONFIG[brand] || BRAND_CONFIG['Jackson Audio']
              const selected = selectedUnits.has(unit.id)

              return (
                <div key={unit.id} onClick={() => toggleUnit(unit.id)}
                  style={{ width: `${sz.width * 96}px`, minHeight: `${sz.height * 96}px`,
                    border: selected ? '2px solid #0071e3' : '1px solid #d2d2d7',
                    borderRadius:8, padding:'6px 10px', display:'flex', alignItems:'center', gap:8,
                    background: selected ? '#fff' : '#fafafa', cursor:'pointer',
                    opacity: selected ? 1 : 0.5, transition:'all 0.15s' }}>
                  {qrImages[unit.id] ? (
                    <img src={qrImages[unit.id]} alt={unit.serial_number}
                      style={{ width: Math.min(sz.qr, 65), height: Math.min(sz.qr, 65), flexShrink:0 }} />
                  ) : (
                    <div style={{ width:50,height:50,background:'#f0f0f2',borderRadius:4,flexShrink:0 }} />
                  )}
                  <div style={{ overflow:'hidden',minWidth:0,lineHeight:1.3 }}>
                    <div style={{ fontSize:7,fontWeight:900,letterSpacing:'0.12em',textTransform:'uppercase',
                      color:cfg.accentColor }}>{cfg.logo}</div>
                    <div style={{ fontSize:10,fontWeight:700,color:'#1d1d1f',overflow:'hidden',
                      textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{prod?.name || '?'}</div>
                    <div style={{ fontSize:12,fontWeight:800,fontFamily:'SF Mono,Menlo,monospace',
                      color:'#1d1d1f' }}>S/N {unit.serial_number}</div>
                    <div style={{ fontSize:6,color:'#aeaeb2',marginTop:1 }}>Scan QR to register · {cfg.tagline}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
