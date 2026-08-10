import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import { watchSplash } from './splash.js'
import './index.css'

// The launch screen in index.html is dismissed by ProfileProvider once profiles
// have loaded. This only arms the failsafe, so a first render that never gets
// that far cannot leave the window covered.
watchSplash()

// HashRouter, not BrowserRouter: a packaged build is served from file://,
// where path-based routing has no server to fall back on.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)
