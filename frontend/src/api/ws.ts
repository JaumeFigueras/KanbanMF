import { getClientId } from './client'

const WS_BASE = 'ws://localhost:8000'
const RECONNECT_DELAY_MS = 3000

export type BoardNotificationType =
  | 'board_shared'
  | 'board_unshared'
  | 'board_archived'
  | 'board_unarchived'
  | 'board_deleted'
  | 'board_reordered'
  | 'list_created'
  | 'list_reordered'
  | 'list_renamed'
  | 'list_archived'
  | 'card_created'
  | 'card_updated'
  | 'card_moved'
  | 'card_order_changed'
  | 'card_archived'

export interface BoardNotification {
  type: BoardNotificationType
  // null only for board_reordered: order is a whole-list property, not tied
  // to one board. Every other event (including all list_* and card_*
  // events) carries the board_id it's about.
  board_id: string | null
  // set only for card_* events — which list's cards to refetch. A
  // card_moved notification is sent once per affected list (source and
  // destination), so this is always a single id, never both at once.
  list_id: string | null
  origin_client_id: string | null
}

type Listener = (notification: BoardNotification) => void

let socket: WebSocket | null = null
let currentToken: string | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<Listener>()

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function openSocket(token: string) {
  socket = new WebSocket(`${WS_BASE}/api/v1/ws?token=${encodeURIComponent(token)}`)

  socket.onmessage = (event) => {
    try {
      const notification = JSON.parse(event.data) as BoardNotification
      listeners.forEach((listener) => listener(notification))
    } catch {
      // ignore malformed messages
    }
  }

  socket.onclose = () => {
    socket = null
    // Only reconnect if we're still supposed to be connected (i.e. the user
    // hasn't logged out in the meantime).
    if (currentToken) {
      clearReconnectTimer()
      reconnectTimer = setTimeout(() => {
        if (currentToken) openSocket(currentToken)
      }, RECONNECT_DELAY_MS)
    }
  }
}

// Called whenever the access token changes (login, silent refresh, logout).
// Connecting is only forced on login/reconnect — a token refresh while the
// socket is already open doesn't need to interrupt it, since the connection
// was already authenticated at handshake time.
export function setWebSocketToken(token: string | null) {
  currentToken = token

  if (!token) {
    clearReconnectTimer()
    socket?.close()
    socket = null
    return
  }

  if (!socket || socket.readyState === WebSocket.CLOSED) {
    openSocket(token)
  }
}

export function subscribeToNotifications(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isOwnNotification(notification: BoardNotification): boolean {
  return notification.origin_client_id === getClientId()
}
