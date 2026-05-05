// ============================================================
// src/components/StickerEditor.jsx
// Visual sticker layout editor for serial number labels
// Drag, resize, recolor, and preview sticker elements
// Templates saved to localStorage for persistence
// ============================================================

import { useState, useRef, useEffect, useCallback } from 'react'
import QRCode from 'qrcode'

const STICKER_SIZES = {
  '2x1':    { name: '2" × 1" (standard pedal)', width: 2, height: 1 },
  '2.5x1':  { name: '2.5" × 1" (large pedal)',  width: 2.5, height: 1 },
  '3x1.5':  { name: '3" × 1.5" (rack unit)',     width: 3, height: 1.5 },
  '2x0.75': { name: '2" × ¾" (mini pedal)',      width: 2, height: 0.75 },
}

const SCALE = 192 // pixels per inch for editor preview

const DEFAULT_ELEMENTS = [
  { id: 'qr',       type: 'qr',    x: 4,   y: 6,  w: 70,  h: 70,  visible: true },
  { id: 'brand',    type: 'text',  x: 82,  y: 8,  w: 200, h: 16,  text: 'JACKSON AUDIO', fontSize: 9, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#c8a84e', fontFamily: "Inter,-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif", visible: true },
  { id: 'product',  type: 'text',  x: 82,  y: 26, w: 200, h: 18,  text: '{product}', fontSize: 11, fontWeight: 700, color: '#1a1a1a', fontFamily: "Inter,-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif", visible: true },
  { id: 'serial',   type: 'text',  x: 82,  y: 46, w: 200, h: 20,  text: 'S/N {serial}', fontSize: 13, fontWeight: 800, color: '#1a1a1a', fontFamily: "'SF Mono',Menlo,monospace", letterSpacing: '0.04em', visible: true },
  { id: 'tagline',  type: 'text',  x: 82,  y: 68, w: 200, h: 14,  text: 'Scan QR to register · jacksonaudio.com', fontSize: 6, fontWeight: 400, color: '#888888', fontFamily: "Inter,-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif", visible: true },
]

const STORAGE_KEY = 'jackson_sticker_templates'

function loadTemplates() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function saveTemplates(templates) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
}

export default function StickerEditor({ onClose, onApplyTemplate }) {
  const [stickerSize, setStickerSize] = useState('2x1')
  const [elements, setElements] = useState(DEFAULT_ELEMENTS.map(e => ({ ...e })))
  const [selectedId, setSelectedId] = useState(null)
  const [bgColor, setBgColor] = useState('#f5f5f5')
  const [borderColor, setBorderColor] = useState('#cccccc')
  const [templates, setTemplates] = useState(loadTemplates)
  const [templateName, setTemplateName] = useState('')
  const [dragState, setDragState] = useState(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const canvasRef = useRef(null)
  const imageInputRef = useRef(null)
  let nextId = useRef(1)

  const sz = STICKER_SIZES[stickerSize]
  const pxW = sz.width * SCALE
  const pxH = sz.height * SCALE

  // Generate sample QR
  useEffect(() => {
    QRCode.toDataURL('https://example.com#register?sn=DEMO-001&product=Demo+Pedal&brand=Jackson+Audio', {
      width: 200, margin: 1, errorCorrectionLevel: 'M',
    }).then(url => setQrDataUrl(url)).catch(() => {})
  }, [])

  const selected = elements.find(e => e.id === selectedId)

  const updateElement = (id, updates) => {
    setElements(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e))
  }

  // Mouse drag handling
  const handleMouseDown = useCallback((e, elemId) => {
    e.stopPropagation()
    const rect = canvasRef.current.getBoundingClientRect()
    const elem = elements.find(el => el.id === elemId)
    if (!elem) return
    setSelectedId(elemId)
    setDragState({
      elemId,
      startX: e.clientX,
      startY: e.clientY,
      origX: elem.x,
      origY: elem.y,
    })
  }, [elements])

  useEffect(() => {
    if (!dragState) return
    const handleMove = (e) => {
      const dx = e.clientX - dragState.startX
      const dy = e.clientY - dragState.startY
      updateElement(dragState.elemId, {
        x: Math.max(0, dragState.origX + dx),
        y: Math.max(0, dragState.origY + dy),
      })
    }
    const handleUp = () => setDragState(null)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragState])

  // Save template
  const handleSaveTemplate = () => {
    const name = templateName.trim() || `Template ${Object.keys(templates).length + 1}`
    const tmpl = { elements: elements.map(e => ({ ...e })), bgColor, borderColor, stickerSize }
    const updated = { ...templates, [name]: tmpl }
    setTemplates(updated)
    saveTemplates(updated)
    setTemplateName('')
  }

  // Load template
  const handleLoadTemplate = (name) => {
    const tmpl = templates[name]
    if (!tmpl) return
    setElements(tmpl.elements.map(e => ({ ...e })))
    setBgColor(tmpl.bgColor || '#f5f5f5')
    setBorderColor(tmpl.borderColor || '#cccccc')
    if (tmpl.stickerSize) setStickerSize(tmpl.stickerSize)
    setSelectedId(null)
  }

  // Delete template
  const handleDeleteTemplate = (name) => {
    const updated = { ...templates }
    delete updated[name]
    setTemplates(updated)
    saveTemplates(updated)
  }

  // Reset to default
  const handleReset = () => {
    setElements(DEFAULT_ELEMENTS.map(e => ({ ...e })))
    setBgColor('#f5f5f5')
    setBorderColor('#cccccc')
    setSelectedId(null)
  }

  // Add a new text element
  const handleAddText = () => {
    const id = `text_${Date.now()}`
    const newElem = {
      id, type: 'text', x: 20, y: 20, w: 150, h: 16,
      text: 'New Text', fontSize: 10, fontWeight: 400, color: '#1a1a1a',
      fontFamily: "Inter,-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif",
      letterSpacing: 'normal', textTransform: 'none', visible: true,
    }
    setElements(prev => [...prev, newElem])
    setSelectedId(id)
  }

  // Add an image element (upload file)
  const handleAddImage = () => {
    imageInputRef.current?.click()
  }

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const id = `img_${Date.now()}`
      const newElem = {
        id, type: 'image', x: 10, y: 10, w: 60, h: 60,
        src: ev.target.result, // base64 data URL
        objectFit: 'contain', visible: true,
        label: file.name.replace(/\.[^.]+$/, ''),
      }
      setElements(prev => [...prev, newElem])
      setSelectedId(id)
    }
    reader.readAsDataURL(file)
    e.target.value = '' // reset so same file can be re-uploaded
  }

  // Delete a custom element (not default ones)
  const handleDeleteElement = (id) => {
    const isDefault = DEFAULT_ELEMENTS.some(e => e.id === id)
    if (isDefault) return // protect defaults
    setElements(prev => prev.filter(e => e.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  // Apply current design to StickerPrintModal
  const handleApply = () => {
    if (onApplyTemplate) {
      onApplyTemplate({ elements: elements.map(e => ({ ...e })), bgColor, borderColor, stickerSize })
    }
    onClose()
  }

  // Generate print preview HTML
  const handleTestPrint = () => {
    const w = window.open('', '_blank', 'width=600,height=400')
    const stickerHtml = renderStickerHTML(elements, sz, bgColor, borderColor, qrDataUrl, {
      serial: 'DEMO-20260327-001',
      product: 'Asabi Overdrive',
      brand: 'JACKSON AUDIO',
      tagline: 'jacksonaudio.com',
    })
    w.document.write(`<!DOCTYPE html><html><head><title>Sticker Test Print</title>
      <style>@page { margin: 0.5in; } * { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: -apple-system, sans-serif; padding: 40px; }
      .label { text-align: center; margin-bottom: 20px; font-size: 12px; color: #666; }</style></head><body>
      <div class="label">Test Print Preview — Actual Size</div>
      ${stickerHtml}
      <script>window.onload = function() { setTimeout(function() { window.print(); }, 400); }<\/script>
    </body></html>`)
    w.document.close()
  }

  const inputStyle = { fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #e3e8ee', outline: 'none', width: '100%', fontFamily: '-apple-system, sans-serif' }
  const labelStyle = { fontSize: 10, fontWeight: 600, color: '#64748d', marginBottom: 2, display: 'block' }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'rgba(0,0,0,0.5)', padding: 20 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 16, maxWidth: 1100, width: '100%', maxHeight: '92vh',
        overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #e5e5ea', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#061b31' }}>Sticker Layout Editor</div>
            <div style={{ fontSize: 12, color: '#64748d', marginTop: 2 }}>Drag elements, adjust styles, save templates</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleReset}
              style={{ padding: '6px 14px', borderRadius: 980, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none', background: '#f0f0f2', color: '#061b31' }}>
              Reset
            </button>
            <button onClick={handleTestPrint}
              style={{ padding: '6px 14px', borderRadius: 980, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none', background: '#5856d6', color: '#fff' }}>
              Test Print
            </button>
            <button onClick={handleApply}
              style={{ padding: '8px 18px', borderRadius: 980, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', background: '#58a6ff', color: '#fff' }}>
              Apply Design
            </button>
            <button onClick={onClose}
              style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#64748d', padding: '4px 8px' }}>
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', gap: 0 }}>

          {/* Left: Canvas */}
          <div style={{ flex: 1, padding: 24, background: '#f6f9fc', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            {/* Size selector */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#64748d', fontWeight: 600 }}>Size:</span>
              <select value={stickerSize} onChange={e => setStickerSize(e.target.value)}
                style={{ ...inputStyle, width: 200 }}>
                {Object.entries(STICKER_SIZES).map(([key, val]) => (
                  <option key={key} value={key}>{val.name}</option>
                ))}
              </select>
            </div>

            {/* Add element buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleAddText}
                style={{ fontSize: 11, padding: '5px 14px', borderRadius: 980, border: 'none', cursor: 'pointer', fontWeight: 600, background: '#58a6ff', color: '#fff' }}>
                + Add Text
              </button>
              <button onClick={handleAddImage}
                style={{ fontSize: 11, padding: '5px 14px', borderRadius: 980, border: 'none', cursor: 'pointer', fontWeight: 600, background: '#34c759', color: '#fff' }}>
                + Add Image
              </button>
              <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
            </div>

            {/* Sticker canvas */}
            <div ref={canvasRef}
              onClick={() => setSelectedId(null)}
              style={{
                width: pxW, height: pxH, background: bgColor,
                border: `2px solid ${borderColor}`, borderRadius: 4,
                position: 'relative', overflow: 'hidden', cursor: 'default',
                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
              }}>
              {elements.filter(e => e.visible).map(elem => (
                <div key={elem.id}
                  onMouseDown={(e) => handleMouseDown(e, elem.id)}
                  onClick={(e) => { e.stopPropagation(); setSelectedId(elem.id) }}
                  style={{
                    position: 'absolute',
                    left: elem.x, top: elem.y,
                    width: elem.w, height: elem.h,
                    cursor: dragState?.elemId === elem.id ? 'grabbing' : 'grab',
                    outline: selectedId === elem.id ? '2px solid #58a6ff' : '1px dashed transparent',
                    outlineOffset: 1,
                    borderRadius: 2,
                    display: 'flex', alignItems: 'center',
                    transition: dragState ? 'none' : 'outline 0.1s',
                    userSelect: 'none',
                  }}>
                  {elem.type === 'qr' ? (
                    qrDataUrl ? <img src={qrDataUrl} alt="QR" style={{ width: elem.w, height: elem.h, imageRendering: 'pixelated' }} draggable={false} /> :
                    <div style={{ width: elem.w, height: elem.h, background: '#e0e0e0', borderRadius: 4 }} />
                  ) : elem.type === 'image' ? (
                    <img src={elem.src} alt={elem.label || 'Image'} draggable={false}
                      style={{ width: elem.w, height: elem.h, objectFit: elem.objectFit || 'contain', borderRadius: 2 }} />
                  ) : (
                    <span style={{
                      fontSize: elem.fontSize || 12,
                      fontWeight: elem.fontWeight || 400,
                      fontFamily: elem.fontFamily || 'sans-serif',
                      color: elem.color || '#1a1a1a',
                      letterSpacing: elem.letterSpacing || 'normal',
                      textTransform: elem.textTransform || 'none',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      width: '100%',
                    }}>
                      {elem.text?.replace('{serial}', 'DEMO-001').replace('{product}', 'Asabi Overdrive').replace('{brand}', 'JACKSON AUDIO') || ''}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div style={{ fontSize: 10, color: '#8898aa', textAlign: 'center' }}>
              Click an element to select it. Drag to reposition. Use the panel on the right to edit properties.
            </div>
          </div>

          {/* Right: Properties panel */}
          <div style={{ width: 300, borderLeft: '1px solid #e5e5ea', padding: 16, overflowY: 'auto', background: '#fff' }}>

            {/* Element list */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#061b31', marginBottom: 8 }}>Elements</div>
              {elements.map(elem => {
                const isDefault = DEFAULT_ELEMENTS.some(d => d.id === elem.id)
                const displayName = elem.type === 'qr' ? 'QR Code' : elem.type === 'image' ? (elem.label || 'Image') : elem.id.charAt(0).toUpperCase() + elem.id.slice(1)
                return (
                <div key={elem.id} onClick={() => setSelectedId(elem.id)}
                  style={{
                    padding: '6px 10px', borderRadius: 8, marginBottom: 4, cursor: 'pointer',
                    background: selectedId === elem.id ? '#58a6ff18' : '#f6f9fc',
                    border: selectedId === elem.id ? '1px solid #58a6ff' : '1px solid transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#061b31', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 9, color: '#8898aa' }}>{elem.type === 'qr' ? 'QR' : elem.type === 'image' ? 'IMG' : 'Aa'}</span>
                    {displayName}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input type="checkbox" checked={elem.visible}
                        onChange={(e) => { e.stopPropagation(); updateElement(elem.id, { visible: e.target.checked }) }} />
                      Show
                    </label>
                    {!isDefault && (
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteElement(elem.id) }}
                        style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, border: 'none', background: '#ff3b30', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                        Del
                      </button>
                    )}
                  </div>
                </div>
                )
              })}
            </div>

            {/* Selected element properties */}
            {selected && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#061b31', marginBottom: 10, borderTop: '1px solid #e5e5ea', paddingTop: 12 }}>
                  Edit: {selected.id.charAt(0).toUpperCase() + selected.id.slice(1)}
                </div>

                {/* Position */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <div>
                    <label style={labelStyle}>X</label>
                    <input type="number" value={Math.round(selected.x)} onChange={e => updateElement(selected.id, { x: +e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Y</label>
                    <input type="number" value={Math.round(selected.y)} onChange={e => updateElement(selected.id, { y: +e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Width</label>
                    <input type="number" value={selected.w} onChange={e => updateElement(selected.id, { w: +e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Height</label>
                    <input type="number" value={selected.h} onChange={e => updateElement(selected.id, { h: +e.target.value })} style={inputStyle} />
                  </div>
                </div>

                {/* Image properties */}
                {selected.type === 'image' && (
                  <>
                    <div style={{ marginBottom: 8 }}>
                      <label style={labelStyle}>Label</label>
                      <input value={selected.label || ''} onChange={e => updateElement(selected.id, { label: e.target.value })} style={inputStyle} placeholder="e.g. Logo" />
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <label style={labelStyle}>Fit Mode</label>
                      <select value={selected.objectFit || 'contain'} onChange={e => updateElement(selected.id, { objectFit: e.target.value })} style={inputStyle}>
                        <option value="contain">Contain (fit inside)</option>
                        <option value="cover">Cover (fill, may crop)</option>
                        <option value="fill">Stretch to fill</option>
                        <option value="none">Original size</option>
                      </select>
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <label style={labelStyle}>Replace Image</label>
                      <input type="file" accept="image/*" style={{ fontSize: 11 }} onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        const reader = new FileReader()
                        reader.onload = (ev) => updateElement(selected.id, { src: ev.target.result, label: file.name.replace(/\.[^.]+$/, '') })
                        reader.readAsDataURL(file)
                      }} />
                    </div>
                    <div style={{ marginBottom: 8, textAlign: 'center' }}>
                      <img src={selected.src} alt="Preview" style={{ maxWidth: '100%', maxHeight: 80, objectFit: 'contain', borderRadius: 4, border: '1px solid #e5e5ea' }} />
                    </div>
                  </>
                )}

                {/* Text properties */}
                {selected.type === 'text' && (
                  <>
                    <div style={{ marginBottom: 8 }}>
                      <label style={labelStyle}>Text Content</label>
                      <input value={selected.text || ''} onChange={e => updateElement(selected.id, { text: e.target.value })} style={inputStyle}
                        placeholder="Use {serial}, {product}, {brand}" />
                      <div style={{ fontSize: 9, color: '#8898aa', marginTop: 2 }}>Variables: {'{serial}'}, {'{product}'}, {'{brand}'}</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                      <div>
                        <label style={labelStyle}>Font Size</label>
                        <input type="number" value={selected.fontSize || 12} onChange={e => updateElement(selected.id, { fontSize: +e.target.value })} style={inputStyle} />
                      </div>
                      <div>
                        <label style={labelStyle}>Font Weight</label>
                        <select value={selected.fontWeight || 400} onChange={e => updateElement(selected.id, { fontWeight: +e.target.value })} style={inputStyle}>
                          {[100,200,300,400,500,600,700,800,900].map(w => <option key={w} value={w}>{w}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <label style={labelStyle}>Font Family</label>
                      <select value={selected.fontFamily || 'sans-serif'} onChange={e => updateElement(selected.id, { fontFamily: e.target.value })} style={inputStyle}>
                        <option value="Inter,-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif">System (San Francisco)</option>
                        <option value="'SF Mono',Menlo,monospace">Monospace (SF Mono)</option>
                        <option value="Georgia,'Times New Roman',serif">Serif (Georgia)</option>
                        <option value="'Courier New',monospace">Courier New</option>
                        <option value="Impact,sans-serif">Impact</option>
                      </select>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                      <div>
                        <label style={labelStyle}>Color</label>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input type="color" value={selected.color || '#1a1a1a'} onChange={e => updateElement(selected.id, { color: e.target.value })}
                            style={{ width: 32, height: 28, border: '1px solid #e3e8ee', borderRadius: 4, cursor: 'pointer', padding: 0 }} />
                          <input value={selected.color || '#1a1a1a'} onChange={e => updateElement(selected.id, { color: e.target.value })}
                            style={{ ...inputStyle, flex: 1 }} />
                        </div>
                      </div>
                      <div>
                        <label style={labelStyle}>Letter Spacing</label>
                        <input value={selected.letterSpacing || 'normal'} onChange={e => updateElement(selected.id, { letterSpacing: e.target.value })} style={inputStyle}
                          placeholder="e.g. 0.12em" />
                      </div>
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <label style={labelStyle}>Text Transform</label>
                      <select value={selected.textTransform || 'none'} onChange={e => updateElement(selected.id, { textTransform: e.target.value })} style={inputStyle}>
                        <option value="none">None</option>
                        <option value="uppercase">UPPERCASE</option>
                        <option value="lowercase">lowercase</option>
                        <option value="capitalize">Capitalize</option>
                      </select>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Background settings */}
            <div style={{ borderTop: '1px solid #e5e5ea', paddingTop: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#061b31', marginBottom: 8 }}>Sticker Background</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={labelStyle}>Fill</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)}
                      style={{ width: 32, height: 28, border: '1px solid #e3e8ee', borderRadius: 4, cursor: 'pointer', padding: 0 }} />
                    <input value={bgColor} onChange={e => setBgColor(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Border</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input type="color" value={borderColor} onChange={e => setBorderColor(e.target.value)}
                      style={{ width: 32, height: 28, border: '1px solid #e3e8ee', borderRadius: 4, cursor: 'pointer', padding: 0 }} />
                    <input value={borderColor} onChange={e => setBorderColor(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Templates */}
            <div style={{ borderTop: '1px solid #e5e5ea', paddingTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#061b31', marginBottom: 8 }}>Templates</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="Template name…" style={{ ...inputStyle, flex: 1 }} />
                <button onClick={handleSaveTemplate}
                  style={{ fontSize: 11, padding: '4px 12px', borderRadius: 6, border: 'none', background: '#34c759', color: '#fff', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  Save
                </button>
              </div>
              {Object.keys(templates).length === 0 && (
                <div style={{ fontSize: 11, color: '#8898aa', fontStyle: 'italic' }}>No saved templates yet</div>
              )}
              {Object.keys(templates).map(name => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', background: '#f6f9fc', borderRadius: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#061b31' }}>{name}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => handleLoadTemplate(name)}
                      style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, border: 'none', background: '#58a6ff', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                      Load
                    </button>
                    <button onClick={() => handleDeleteTemplate(name)}
                      style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, border: 'none', background: '#ff3b30', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Helper: render a sticker as HTML string for printing
export function renderStickerHTML(elements, sz, bgColor, borderColor, qrDataUrl, data) {
  const visibleElements = elements.filter(e => e.visible)
  const innerHtml = visibleElements.map(elem => {
    if (elem.type === 'qr') {
      return qrDataUrl
        ? `<img src="${qrDataUrl}" style="position:absolute;left:${elem.x}px;top:${elem.y}px;width:${elem.w}px;height:${elem.h}px;image-rendering:pixelated" />`
        : ''
    }
    if (elem.type === 'image') {
      return elem.src
        ? `<img src="${elem.src}" style="position:absolute;left:${elem.x}px;top:${elem.y}px;width:${elem.w}px;height:${elem.h}px;object-fit:${elem.objectFit || 'contain'};border-radius:2px" />`
        : ''
    }
    const text = (elem.text || '')
      .replace('{serial}', data.serial || '')
      .replace('{product}', data.product || '')
      .replace('{brand}', data.brand || '')
    return `<div style="position:absolute;left:${elem.x}px;top:${elem.y}px;width:${elem.w}px;height:${elem.h}px;display:flex;align-items:center;overflow:hidden">
      <span style="font-size:${elem.fontSize || 12}px;font-weight:${elem.fontWeight || 400};font-family:${elem.fontFamily || 'sans-serif'};color:${elem.color || '#1a1a1a'};letter-spacing:${elem.letterSpacing || 'normal'};text-transform:${elem.textTransform || 'none'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%">${text}</span>
    </div>`
  }).join('')

  return `<div style="width:${sz.width}in;height:${sz.height}in;position:relative;overflow:hidden;background:${bgColor};border:0.5px solid ${borderColor};box-sizing:border-box">${innerHtml}</div>`
}
