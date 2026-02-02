import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode disabled - causes double chart creation with lightweight-charts
createRoot(document.getElementById('root')!).render(
  <App />
)
