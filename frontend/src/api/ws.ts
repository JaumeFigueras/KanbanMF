import { getClientId, refreshAccessToken } from './client'

const RECONNECT_DELAY_MS = 3000

// Same-origin, like API_BASE in client.ts — derived from window.location
// rather than a relative WebSocket URL string, since resolving a scheme-less
// URL against an http(s) page yields an http(s) URL, which the WebSocket
// constructor rejects (it requires ws/wss).
function wsUrl(path: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${window.location.host}${path}`
}

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
  | 'list_unarchived'
  | 'list_deleted'
  | 'card_created'
  | 'card_updated'
  | 'card_moved'
  | 'card_order_changed'
  | 'card_archived'
  | 'card_unarchived'
  | 'card_deleted'
  // Sent only to the board owner, whose share dialog lists the invitations.
  | 'board_invitations_changed'

export interface BoardNotification {
  type: BoardNotificationType
  // null only for board_reordered: order is a whole-list property, not tied
  // to one board. Every other event (including all list_* and card_*
  // events) carries the board_id it's about.
  board_id: string | null
  // set only for card_* events and list_unarchived — which list's cards to
  // refetch. A
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

// Closed by the backend: the token wasn't accepted.
const WS_POLICY_VIOLATION = 1008

function openSocket(token: string) {
  // The token goes in the first message, not the URL: addresses end up in
  // the web server's access log.
  socket = new WebSocket(wsUrl('/api/v1/ws'))

  socket.onopen = () => {
    socket?.send(JSON.stringify({ type: 'auth', token }))
  }

  socket.onmessage = (event) => {
    try {
      const notification = JSON.parse(event.data) as BoardNotification
      listeners.forEach((listener) => listener(notification))
    } catch {
      // ignore malformed messages
    }
  }

  socket.onclose = (event) => {
    socket = null
    // A refused token has most likely expired (say, the computer slept):
    // get a new one, which reconnects through setWebSocketToken, or signs
    // out if the session is gone too. After the same delay as a reconnect,
    // so a token that keeps being refused can't spin refreshes.
    if (event.code === WS_POLICY_VIOLATION && currentToken) {
      clearReconnectTimer()
      reconnectTimer = setTimeout(() => {
        if (!currentToken) return
        currentToken = null
        void refreshAccessToken()
      }, RECONNECT_DELAY_MS)
      return
    }
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
// was already authenticated by its first message.
export function setWebSocketToken(token: string | null) {
  currentToken = token

  if (!token) {
    clearReconnectTimer()
    socket?.close()
    socket = null
    return
  }

  if (!socket || socket.readyState === WebSocket.CLOSED) {
    clearReconnectTimer()
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
