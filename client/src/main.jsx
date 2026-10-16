import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import AppRoutes from './AppRoutes.jsx'
import ErrorBoundary from './components/common/ErrorBoundary.jsx'
import { AuthProvider } from './contexts/AuthProvider.jsx'
import { applyStoredTheme } from './hooks/useTheme.js'

applyStoredTheme()

// AuthProvider sits inside the router because the sign-in flows navigate, and outside
// the routes because every one of them needs to know who is signed in.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
