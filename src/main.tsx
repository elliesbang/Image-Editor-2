import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

const container = document.getElementById('root')

if (!container) {
  throw new Error('Root element with id "root" is required to mount the application.')
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
