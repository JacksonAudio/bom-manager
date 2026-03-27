import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Scoreboard from './components/Scoreboard.jsx'
import RegisterProduct from './components/RegisterProduct.jsx'

const hash = window.location.hash

// Scoreboard is fully standalone (no auth required — TV display)
const isScoreboard = hash === '#scoreboard'

// Product registration is public (no auth — customer scans QR on pedal)
const isRegister = hash.startsWith('#register')

// Build and Invoice views render inside App (auth required)
// They are handled in App.jsx after authentication

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isScoreboard ? <Scoreboard standalone /> : isRegister ? <RegisterProduct /> : <App />}
  </StrictMode>,
)
