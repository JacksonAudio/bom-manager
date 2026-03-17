import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Scoreboard from './components/Scoreboard.jsx'

const isScoreboard = window.location.hash === '#scoreboard'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isScoreboard ? <Scoreboard standalone /> : <App />}
  </StrictMode>,
)
