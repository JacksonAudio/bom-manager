import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Scoreboard from './components/Scoreboard.jsx'
import RegisterProduct from './components/RegisterProduct.jsx'

const hash = window.location.hash
const pathname = window.location.pathname
const hostname = window.location.hostname.toLowerCase()

// Scoreboard is fully standalone (no auth required — TV display)
// Accepts /scoreboard (new) or #scoreboard (legacy bookmarks)
const isScoreboard = hash === '#scoreboard' || pathname === '/scoreboard' || pathname.startsWith('/scoreboard/')

// Product registration is public (no auth — customer scans QR on pedal)
// Auto-detect from hostname (register.jacksonaudio.net, register.fulltoneusa.com)
// Also accepts /register or #register (legacy QR codes on already-shipped pedals)
const isRegister = hostname.startsWith('register.')
  || hash.startsWith('#register')
  || pathname === '/register'
  || pathname.startsWith('/register/')

// Build and Invoice views render inside App (auth required)
// They are handled in App.jsx after authentication

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isScoreboard ? <Scoreboard standalone /> : isRegister ? <RegisterProduct /> : <App />}
  </StrictMode>,
)
