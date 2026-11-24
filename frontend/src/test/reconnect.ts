import { setWebSocketToken } from '../api/ws'
import { FakeWebSocket } from './fakeWebSocket'
import { TEST_ACCESS_TOKEN } from './render'

// The connection drops and comes back. api/ws.ts opens the next socket 3 s
// after a drop, with the same token (api/ws.test.ts checks that); here it
// opens at once. Returns the new socket, open.
export function dropAndReconnect(socket: FakeWebSocket, token = TEST_ACCESS_TOKEN): FakeWebSocket {
  socket.serverClose()
  setWebSocketToken(token)
  const next = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  next.open()
  return next
}
