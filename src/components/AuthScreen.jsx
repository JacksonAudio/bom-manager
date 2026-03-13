// ============================================================
// src/components/AuthScreen.jsx
// Thursday, March 12, 2026
//
// Login / Sign-up screen shown when no session is active.
// Uses Supabase email+password auth.
// ============================================================

import { useState } from 'react'
import { signIn, signUp } from '../lib/db.js'

// ─────────────────────────────────────────────
// Inline styles shared across the form
// ─────────────────────────────────────────────
const S = {
  wrap: {
    minHeight: '100vh', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: '#080a0f', padding: 24,
  },
  card: {
    width: '100%', maxWidth: 420, background: '#0f1118',
    border: '1px solid #1e2130', borderRadius: 12, padding: 40,
  },
  logo: {
    fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800,
    fontSize: 13, letterSpacing: '0.15em', color: '#f8d377',
    marginBottom: 8,
  },
  title: {
    fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800,
    fontSize: 22, color: '#f1f5f9', marginBottom: 6,
  },
  sub: { fontSize: 12, color: '#475569', marginBottom: 32 },
  label: { display: 'block', fontSize: 11, color: '#64748b', marginBottom: 5, letterSpacing: '0.06em' },
  input: {
    width: '100%', padding: '10px 14px', borderRadius: 7, fontSize: 13,
    background: '#0d0f14', border: '1px solid #1e2130', color: '#e2e8f0',
    outline: 'none', marginBottom: 16,
  },
  btnPrimary: {
    width: '100%', padding: '11px 0', borderRadius: 7, fontSize: 13,
    fontWeight: 700, background: '#f8d377', color: '#080a0f',
    border: 'none', cursor: 'pointer', fontFamily: "'Space Grotesk', sans-serif",
    marginTop: 4,
  },
  toggleRow: {
    display: 'flex', justifyContent: 'center', gap: 6,
    fontSize: 12, color: '#475569', marginTop: 22,
  },
  toggleBtn: {
    background: 'none', border: 'none', color: '#7dd3fc',
    cursor: 'pointer', fontSize: 12, padding: 0,
  },
  error: {
    background: '#2d0e0e', border: '1px solid #ef4444', borderRadius: 6,
    padding: '9px 12px', fontSize: 12, color: '#fca5a5', marginBottom: 16,
  },
  success: {
    background: '#0a1f15', border: '1px solid #34d399', borderRadius: 6,
    padding: '9px 12px', fontSize: 12, color: '#6ee7b7', marginBottom: 16,
  },
}

export default function AuthScreen() {
  const [mode,     setMode]     = useState('login')   // 'login' | 'signup'
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState('')

  // ── Handle form submit for both login and signup
  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setSuccess('')
    setLoading(true)
    try {
      if (mode === 'signup') {
        await signUp(email, password)
        setSuccess('Check your email to confirm your account, then come back to log in.')
      } else {
        await signIn(email, password)
        // Auth state change in App.jsx picks up the new session automatically
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.logo}>JACKSON AUDIO</div>
        <div style={S.title}>{mode === 'login' ? 'Sign In' : 'Create Account'}</div>
        <div style={S.sub}>BOM Manager — team workspace</div>

        {error   && <div style={S.error}>{error}</div>}
        {success && <div style={S.success}>{success}</div>}

        <form onSubmit={handleSubmit}>
          <label style={S.label}>EMAIL</label>
          <input
            type="email" required autoComplete="email"
            value={email} onChange={e => setEmail(e.target.value)}
            style={S.input} placeholder="you@jacksonaudio.com"
          />
          <label style={S.label}>PASSWORD</label>
          <input
            type="password" required autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password} onChange={e => setPassword(e.target.value)}
            style={S.input} placeholder="••••••••"
          />
          <button type="submit" style={S.btnPrimary} disabled={loading}>
            {loading ? 'Working…' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div style={S.toggleRow}>
          <span>{mode === 'login' ? "Don't have an account?" : 'Already have an account?'}</span>
          <button style={S.toggleBtn} onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setSuccess('') }}>
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </div>
      </div>
    </div>
  )
}
