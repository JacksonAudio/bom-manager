// ============================================================
// src/components/RegisterProduct.jsx
// Public product registration page — no auth required
// Customer scans QR on pedal bottom → lands here → fills out form
// Supports Jackson Audio and Fulltone USA branding
// ============================================================

import { useState, useEffect } from 'react'

const BRANDS = {
  'Jackson Audio': {
    logo: 'JACKSON AUDIO',
    tagline: 'Premium Guitar Effects',
    website: 'jackson.audio',
    accentColor: '#c8a84e',
    bgGradient: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
    cardBg: '#ffffff',
  },
  'Fulltone USA': {
    logo: 'FULLTONE USA',
    tagline: 'Handcrafted Tone Since 1991',
    website: 'www.fulltoneusa.com',
    accentColor: '#b22222',
    bgGradient: 'linear-gradient(135deg, #1a1a1a 0%, #3a1a1a 100%)',
    cardBg: '#ffffff',
  },
}

export default function RegisterProduct() {
  const params = new URLSearchParams(window.location.search || window.location.hash.split('?')[1] || '')
  const snFromUrl = params.get('sn') || ''
  const productFromUrl = params.get('product') || ''

  // Detect brand from hostname, URL param, or product name
  const detectBrand = () => {
    // 1. Hostname detection (register.fulltoneusa.com → Fulltone USA)
    const host = window.location.hostname.toLowerCase()
    if (host.includes('fulltone')) return 'Fulltone USA'
    // 2. Explicit URL param
    const b = params.get('brand')
    if (b && BRANDS[b]) return b
    // 3. Product name fallback
    if (productFromUrl.toLowerCase().includes('fulltone')) return 'Fulltone USA'
    return 'Jackson Audio'
  }

  const [brand] = useState(detectBrand)
  const cfg = BRANDS[brand] || BRANDS['Jackson Audio']

  // Set page title to brand name
  useEffect(() => { document.title = `${brand} — Product Registration` }, [brand])

  const [form, setForm] = useState({
    serial_number: snFromUrl,
    product_name: productFromUrl,
    customer_name: '',
    customer_email: '',
    customer_phone: '',
    customer_address: '',
    customer_city: '',
    customer_state: '',
    customer_zip: '',
    customer_country: 'US',
    purchase_date: '',
    purchased_from: '',
    notes: '',
  })
  const [emailOptIn, setEmailOptIn] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!form.serial_number.trim() || !form.customer_name.trim() || !form.customer_email.trim()) {
      setError('Please fill in all required fields.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, brand, email_opt_in: emailOptIn }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Registration failed. Please try again.')
        setSubmitting(false)
        return
      }

      setSuccess(true)
    } catch (err) {
      setError('Network error. Please check your connection and try again.')
    }
    setSubmitting(false)
  }

  const inputStyle = {
    width: '100%',
    padding: '12px 16px',
    fontSize: 16,
    borderRadius: 10,
    border: '1px solid #e3e8ee',
    outline: 'none',
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    transition: 'border-color 0.2s',
    boxSizing: 'border-box',
  }

  const labelStyle = {
    display: 'block',
    fontSize: 12,
    fontWeight: 700,
    color: '#64748d',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  }

  if (success) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: cfg.bgGradient, padding: 20,
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
        <div style={{ background: '#fff', borderRadius: 24, padding: '60px 40px', maxWidth: 500,
          width: '100%', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.15em', color: cfg.accentColor,
            textTransform: 'uppercase', marginBottom: 8 }}>{cfg.logo}</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#061b31', margin: '0 0 12px 0' }}>
            You're Registered!
          </h1>
          <p style={{ fontSize: 16, color: '#64748d', lineHeight: 1.6, marginBottom: 8 }}>
            Your <strong style={{ color: '#061b31' }}>{form.product_name || 'product'}</strong> with serial number{' '}
            <strong style={{ color: '#061b31', fontFamily: 'SF Mono, Menlo, monospace' }}>{form.serial_number}</strong>{' '}
            has been registered.
          </p>
          <p style={{ fontSize: 14, color: '#8898aa', marginBottom: 24 }}>
            A confirmation has been sent to <strong>{form.customer_email}</strong>.
          </p>
          <p style={{ fontSize: 13, color: '#64748d' }}>
            Thank you for choosing {brand}. Enjoy your tone!
          </p>
          <a href={`https://${cfg.website}`} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-block', marginTop: 20, padding: '12px 28px', borderRadius: 980,
              background: cfg.accentColor, color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: 14 }}>
            Visit {cfg.website}
          </a>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: cfg.bgGradient, padding: 20,
      fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <div style={{ background: '#fff', borderRadius: 24, maxWidth: 560, width: '100%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ background: '#1a1a1a', padding: '32px 36px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: '0.2em', color: cfg.accentColor,
            textTransform: 'uppercase', marginBottom: 4 }}>{cfg.logo}</div>
          <div style={{ fontSize: 13, color: '#888', letterSpacing: '0.05em' }}>{cfg.tagline}</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#fff', margin: '16px 0 0 0',
            letterSpacing: '-0.3px' }}>Register Your Product</h1>
          <p style={{ fontSize: 14, color: '#888', marginTop: 6, lineHeight: 1.5 }}>
            Activate your warranty and stay up to date with the latest from {brand}.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '28px 36px 36px 36px' }}>
          {error && (
            <div style={{ background: '#fff0f0', border: '1px solid #ffcdd2', borderRadius: 10,
              padding: '12px 16px', marginBottom: 20, fontSize: 14, color: '#d32f2f', fontWeight: 600 }}>
              {error}
            </div>
          )}

          {/* Product info (pre-filled from QR) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div>
              <label style={labelStyle}>Serial Number *</label>
              <input style={{ ...inputStyle, fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 700,
                background: snFromUrl ? '#fafbfc' : '#fff' }}
                value={form.serial_number} onChange={set('serial_number')}
                placeholder="e.g. BLOOM-20260327-001" required readOnly={!!snFromUrl} />
            </div>
            <div>
              <label style={labelStyle}>Product</label>
              <input style={{ ...inputStyle, background: productFromUrl ? '#fafbfc' : '#fff' }}
                value={form.product_name} onChange={set('product_name')}
                placeholder="e.g. Bloom V2" readOnly={!!productFromUrl} />
            </div>
          </div>

          <div style={{ height: 1, background: '#e5e5ea', margin: '4px 0 20px 0' }} />

          {/* Customer info */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Your Name *</label>
              <input style={inputStyle} value={form.customer_name} onChange={set('customer_name')}
                placeholder="Full name" required autoFocus />
            </div>
            <div>
              <label style={labelStyle}>Email *</label>
              <input type="email" style={inputStyle} value={form.customer_email} onChange={set('customer_email')}
                placeholder="you@email.com" required />
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Phone</label>
            <input type="tel" style={inputStyle} value={form.customer_phone} onChange={set('customer_phone')}
              placeholder="(555) 123-4567" />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Address</label>
            <input style={inputStyle} value={form.customer_address} onChange={set('customer_address')}
              placeholder="Street address" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>City</label>
              <input style={inputStyle} value={form.customer_city} onChange={set('customer_city')} placeholder="City" />
            </div>
            <div>
              <label style={labelStyle}>State</label>
              <input style={inputStyle} value={form.customer_state} onChange={set('customer_state')} placeholder="State" />
            </div>
            <div>
              <label style={labelStyle}>ZIP</label>
              <input style={inputStyle} value={form.customer_zip} onChange={set('customer_zip')} placeholder="ZIP" />
            </div>
          </div>

          <div style={{ height: 1, background: '#e5e5ea', margin: '4px 0 20px 0' }} />

          {/* Purchase info */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Purchase Date</label>
              <input type="date" style={inputStyle} value={form.purchase_date} onChange={set('purchase_date')} />
            </div>
            <div>
              <label style={labelStyle}>Where did you buy it?</label>
              <input style={inputStyle} value={form.purchased_from} onChange={set('purchased_from')}
                placeholder="e.g. Sweetwater, direct, etc." />
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle}>Anything else?</label>
            <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
              value={form.notes} onChange={set('notes')}
              placeholder="How are you using this pedal? Any feedback for us?" />
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 20, cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setEmailOptIn(!emailOptIn)}>
            <div style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${emailOptIn ? cfg.accentColor : '#e3e8ee'}`,
              background: emailOptIn ? cfg.accentColor : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, marginTop: 1, transition: 'all 0.15s' }}>
              {emailOptIn && <span style={{ color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>}
            </div>
            <span style={{ fontSize: 13, color: '#555', lineHeight: 1.5 }}>
              Yes, I'd like to receive news, updates, and exclusive offers from {brand}. You can unsubscribe at any time.
            </span>
          </label>

          <button type="submit" disabled={submitting}
            style={{ width: '100%', padding: '14px 28px', borderRadius: 980, border: 'none',
              background: cfg.accentColor, color: '#fff', fontSize: 16, fontWeight: 700,
              cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.7 : 1,
              fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
              transition: 'opacity 0.2s' }}>
            {submitting ? 'Registering…' : 'Register My Product'}
          </button>

          <p style={{ fontSize: 11, color: '#8898aa', textAlign: 'center', marginTop: 14, lineHeight: 1.5 }}>
            By registering, you activate your warranty. We never share your information.
          </p>
        </form>
      </div>
    </div>
  )
}
