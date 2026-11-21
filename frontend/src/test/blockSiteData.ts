// Makes the browser refuse its storage, as one that blocks site data does:
// even reading window.localStorage or window.sessionStorage throws a
// SecurityError. setup.ts puts it back after each test (with
// restoreSiteData(), before it clears the storage).

const restorers: (() => void)[] = []

export function blockSiteData() {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    const original = Object.getOwnPropertyDescriptor(window, name)!
    Object.defineProperty(window, name, {
      configurable: true,
      get() {
        throw new DOMException(`Failed to read the '${name}' property from 'Window': Access is denied for this document.`, 'SecurityError')
      },
    })
    restorers.push(() => Object.defineProperty(window, name, original))
  }
}

export function restoreSiteData() {
  while (restorers.length) restorers.pop()!()
}
