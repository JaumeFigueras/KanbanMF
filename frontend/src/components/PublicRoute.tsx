import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function PublicRoute({ children }: { children: ReactNode }) {
  const { accessToken, loading } = useAuth()

  if (loading) return null

  return accessToken ? <Navigate to="/boards" replace /> : <>{children}</>
}
