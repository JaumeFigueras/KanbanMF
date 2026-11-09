// Stands in for the browser's WebSocket in every test (installed by setup.ts),
// so signing in — which opens the notification socket (api/ws.ts) — never
// tries to reach a server. It records what was opened and sent; tests that
// need a live socket can drive it with open(), receive() and serverClose().
export class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  // Every socket opened since the last reset, oldest first.
  static instances: FakeWebSocket[] = []

  static reset() {
    FakeWebSocket.instances = []
  }

  readonly url: string
  readyState: number = FakeWebSocket.CONNECTING
  sent: string[] = []
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(url: string | URL) {
    this.url = String(url)
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close'))
  }

  // Test-side controls: what the server would do.
  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  receive(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }))
  }

  serverClose() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close'))
  }
}
