import { getAccessToken, getClientId, refreshAccessToken } from './client'

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
  // A label renamed, recoloured, reordered or deleted: every card showing
  // labels needs fetching again.
  | 'labels_changed'

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
// Told when a socket opens again after the last one closed (a dropped
// connection, a restarted backend, a refused token replaced): the
// notifications sent meanwhile are lost, so each page fetches again what it
// shows. Not on the first socket since signing in, as the pages fetched what
// they show when they opened.
const reconnectListeners = new Set<() => void>()
let connectedBefore = false

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

// Closed by the backend: the token wasn't accepted.
const WS_POLICY_VIOLATION = 1008

// A refused token has most likely expired (say, the computer slept): get a
// new one, which reconnects through setWebSocketToken, or signs out if the
// session is gone too. After the same delay as a reconnect, so a token that
// keeps being refused can't spin refreshes. A refresh with no answer (the
// network not back yet) leaves the session as it is: ask again after the
// same delay, unless the user signed out meanwhile or a new token has
// already reconnected the socket.
function refreshAfterDelay() {
  reconnectTimer = setTimeout(() => {
    currentToken = null
    refreshAccessToken().catch(() => {
      if (getAccessToken() && !socket) refreshAfterDelay()
    })
  }, RECONNECT_DELAY_MS)
}

function openSocket(token: string) {
  // The token goes in the first message, not the URL: addresses end up in
  // the web server's access log.
  const ws = new WebSocket(wsUrl('/api/v1/ws'))
  socket = ws

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'auth', token }))
    if (connectedBefore) reconnectListeners.forEach((listener) => listener())
    connectedBefore = true
  }

  ws.onmessage = (event) => {
    try {
      const notification = JSON.parse(event.data) as BoardNotification
      listeners.forEach((listener) => listener(notification))
    } catch {
      // ignore malformed messages
    }
  }

  ws.onclose = (event) => {
    // A close event arrives a moment after close(): by then a sign-out may
    // have let go of this socket, and a sign-in opened the next one. Only
    // the current socket's closing may touch the state or reconnect. So a
    // sign-out never gets past here, and it cancels the timers below too:
    // whenever they fire, the user is still signed in.
    if (socket !== ws) return
    socket = null
    clearReconnectTimer()
    if (event.code === WS_POLICY_VIOLATION) {
      refreshAfterDelay()
      return
    }
    // Any other close: the connection dropped, so try again with the
    // current token.
    reconnectTimer = setTimeout(() => setWebSocketToken(currentToken), RECONNECT_DELAY_MS)
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
    connectedBefore = false
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

export function subscribeToReconnects(listener: () => void): () => void {
  reconnectListeners.add(listener)
  return () => reconnectListeners.delete(listener)
}

export function isOwnNotification(notification: BoardNotification): boolean {
  return notification.origin_client_id === getClientId()
}
