import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { fakeEndpoint, heldAnswer, type Answer } from '../test/endpoints'
import { makeBoard } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import ConnectedAppsDialog from './ConnectedAppsDialog'

const GRANTS = '/api/v1/oauth/grants'
const GRANT = '/api/v1/oauth/grants/:grantId'

const CLAUDE = {
  id: 'grant-1',
  client_name: 'Claude',
  redirect_host: 'claude.ai',
  read_only: false,
  created_at: '2026-01-15T09:00:00Z',
  last_used_at: '2026-03-05T13:30:00Z',
  boards: [
    { id: 'board-1', name: 'Website redesign', is_archived: false },
    { id: 'board-4', name: 'Old site', is_archived: true },
  ],
}

const CLAUDE_CODE = {
  id: 'grant-2',
  client_name: 'Claude Code',
  redirect_host: 'localhost',
  read_only: true,
  created_at: '2026-02-01T08:00:00Z',
  last_used_at: null,
  boards: [],
}

// The user's own boards, newest first as the boards page gets them.
const OWNED = [
  makeBoard({ id: 'board-2', name: 'Marketing' }),
  makeBoard({ id: 'board-1', name: 'Website redesign' }),
  makeBoard({ id: 'board-3', name: 'Accounts' }),
]

function fakeApps({ grants = () => HttpResponse.json([CLAUDE, CLAUDE_CODE]), owned = OWNED }: { grants?: Answer; owned?: unknown[] } = {}) {
  return {
    grants: fakeEndpoint('get', GRANTS, grants),
    boards: fakeEndpoint('get', '/api/v1/boards', () => HttpResponse.json({ owned, shared: [], templates: [] })),
  }
}

const notFound = () => HttpResponse.json({ detail: 'Connection not found' }, { status: 404 })

function renderDialog({ open = true }: { open?: boolean } = {}) {
  const onClose = vi.fn()
  const dialog = (shown: boolean) => (
    <ConnectedAppsDialog open={shown} onClose={onClose} numberLocale="en_GB" dateFormat="numeric" />
  )
  const result = renderWithProviders(dialog(open))
  // Closes the dialog and opens it again, as the account menu does.
  function reopen() {
    result.rerender(dialog(false))
    result.rerender(dialog(true))
  }
  return { ...result, onClose, reopen }
}

// One app's box, found by its name.
function app(name: string) {
  return screen.getByText(name, { selector: 'p' }).closest('.MuiPaper-root') as HTMLElement
}

async function loaded() {
  await screen.findByText('Claude Code', { selector: 'p' })
}

describe('ConnectedAppsDialog', () => {
  describe('listing', () => {
    it('shows each app: its name, whether it can change things, where answers go, and when it was connected and used', async () => {
      fakeApps()
      renderDialog()
      await loaded()
      expect(screen.getByRole('dialog', { name: 'Connected apps' })).toBeInTheDocument()
      expect(within(app('Claude')).getByText('Can make changes')).toBeInTheDocument()
      expect(within(app('Claude')).getByText(
        'Answers go to claude.ai · connected 15/01/2026, 10:00 · last used 05/03/2026, 14:30',
      )).toBeInTheDocument()
      expect(within(app('Claude Code')).getByText('Read-only')).toBeInTheDocument()
      expect(within(app('Claude Code')).getByText(/last used never$/)).toBeInTheDocument()
    })

    it('shows the boards each app can reach, archived ones marked', async () => {
      fakeApps()
      renderDialog()
      await loaded()
      expect(within(app('Claude')).getByText('Website redesign')).toBeInTheDocument()
      expect(within(app('Claude')).getByText('Old site (archived)')).toBeInTheDocument()
      expect(within(app('Claude Code')).getByText('No boards: it can reach nothing until you choose some.')).toBeInTheDocument()
    })

    it('says when no apps are connected', async () => {
      fakeApps({ grants: () => HttpResponse.json([]) })
      renderDialog()
      expect(await screen.findByText('No apps are connected.')).toBeInTheDocument()
    })

    it('waits for the apps', async () => {
      const held = heldAnswer(() => HttpResponse.json([CLAUDE, CLAUDE_CODE]))
      fakeApps({ grants: held.answer })
      renderDialog()
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
      expect(screen.queryByText('No apps are connected.')).not.toBeInTheDocument()
      held.release()
      await loaded()
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })

    it("says so when the apps can't be loaded", async () => {
      fakeApps({ grants: notFound })
      renderDialog()
      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
      expect(screen.queryByText('No apps are connected.')).not.toBeInTheDocument()
    })

    it("says so when the boards to choose from can't be loaded", async () => {
      fakeApps()
      fakeEndpoint('get', '/api/v1/boards', () => HttpResponse.json({ detail: 'Server error' }, { status: 500 }))
      renderDialog()
      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
      expect(screen.queryByText('Claude', { selector: 'p' })).not.toBeInTheDocument()
    })

    it('loads nothing while closed', async () => {
      const loads = fakeApps()
      renderDialog({ open: false })
      // Gives a request, if any, time to arrive.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect([...loads.grants.requests, ...loads.boards.requests]).toEqual([])
    })
  })

  describe('the address to connect to', () => {
    it("shows this site's address", async () => {
      fakeApps()
      renderDialog()
      expect(screen.getByText(`${window.location.origin}/mcp`)).toBeInTheDocument()
    })

    it('copies it, and says so', async () => {
      fakeApps()
      const { user } = renderDialog()
      await user.click(screen.getByRole('button', { name: 'Copy address' }))
      expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/mcp`)
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Copied')
    })

    it("doesn't say copied when the clipboard refuses", async () => {
      fakeApps()
      const { user } = renderDialog()
      const refusing = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Not allowed'))
      onTestFinished(() => refusing.mockRestore())
      await user.click(screen.getByRole('button', { name: 'Copy address' }))
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Copy address')
    })
  })

  describe('changing the boards', () => {
    it("offers the user's own boards alphabetically, with the app's live ones ticked", async () => {
      fakeApps()
      const { user } = renderDialog()
      await loaded()

      await user.click(within(app('Claude')).getByRole('button', { name: 'Change boards' }))

      const boxes = within(app('Claude')).getAllByRole('checkbox')
      expect(boxes.map((b) => b.closest('label')?.textContent)).toEqual(['Accounts', 'Marketing', 'Website redesign'])
      expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([false, false, true])
      expect(within(app('Claude')).getByRole('switch', { name: 'Read-only' })).not.toBeChecked()
    })

    it('starts from whether the app is read-only', async () => {
      fakeApps()
      const { user } = renderDialog()
      await loaded()
      await user.click(within(app('Claude Code')).getByRole('button', { name: 'Change boards' }))
      expect(within(app('Claude Code')).getByRole('switch', { name: 'Read-only' })).toBeChecked()
    })

    it('saves the boards ticked and the read-only choice, then shows them', async () => {
      fakeApps()
      const updated = { ...CLAUDE, read_only: true, boards: [{ id: 'board-2', name: 'Marketing', is_archived: false }] }
      const saved = fakeEndpoint('patch', GRANT, () => HttpResponse.json(updated))
      const { user } = renderDialog()
      await loaded()

      await user.click(within(app('Claude')).getByRole('button', { name: 'Change boards' }))
      await user.click(within(app('Claude')).getByRole('checkbox', { name: 'Website redesign' }))
      await user.click(within(app('Claude')).getByRole('checkbox', { name: 'Marketing' }))
      await user.click(within(app('Claude')).getByRole('switch', { name: 'Read-only' }))
      await user.click(within(app('Claude')).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(within(app('Claude')).getByText('Marketing')).toBeInTheDocument())
      expect(saved.requests.map((r) => [r.url.pathname, r.body])).toEqual([
        ['/api/v1/oauth/grants/grant-1', { board_ids: ['board-2'], read_only: true }],
      ])
      expect(within(app('Claude')).getByText('Read-only')).toBeInTheDocument()
      expect(within(app('Claude')).queryByRole('checkbox')).not.toBeInTheDocument()
    })

    it("can't be saved with no board ticked", async () => {
      fakeApps()
      const { user } = renderDialog()
      await loaded()
      await user.click(within(app('Claude')).getByRole('button', { name: 'Change boards' }))
      await user.click(within(app('Claude')).getByRole('checkbox', { name: 'Website redesign' }))
      expect(within(app('Claude')).getByRole('button', { name: 'Save' })).toBeDisabled()
    })

    it('says when the user owns no boards to choose', async () => {
      fakeApps({ owned: [] })
      const { user } = renderDialog()
      await loaded()
      await user.click(within(app('Claude')).getByRole('button', { name: 'Change boards' }))
      expect(within(app('Claude')).getByText("You don't have any boards of your own yet.")).toBeInTheDocument()
    })

    it('Cancel leaves the app as it was', async () => {
      fakeApps()
      const saved = fakeEndpoint('patch', GRANT)
      const { user } = renderDialog()
      await loaded()
      await user.click(within(app('Claude')).getByRole('button', { name: 'Change boards' }))
      await user.click(within(app('Claude')).getByRole('checkbox', { name: 'Marketing' }))

      await user.click(within(app('Claude')).getByRole('button', { name: 'Cancel' }))

      expect(within(app('Claude')).queryByRole('checkbox')).not.toBeInTheDocument()
      expect(within(app('Claude')).queryByText('Marketing')).not.toBeInTheDocument()
      expect(saved.requests).toEqual([])
    })

    it('edits one app at a time', async () => {
      fakeApps()
      const { user } = renderDialog()
      await loaded()
      await user.click(within(app('Claude')).getByRole('button', { name: 'Change boards' }))
      await user.click(within(app('Claude Code')).getByRole('button', { name: 'Change boards' }))
      expect(within(app('Claude')).queryByRole('checkbox')).not.toBeInTheDocument()
      expect(within(app('Claude Code')).getAllByRole('checkbox')).toHaveLength(3)
    })

    it("says so, and keeps the choices, when the change can't be saved", async () => {
      fakeApps()
      fakeEndpoint('patch', GRANT, () => HttpResponse.json({ detail: 'Only your own boards can be chosen.' }, { status: 422 }))
      const { user } = renderDialog()
      await loaded()
      await user.click(within(app('Claude')).getByRole('button', { name: 'Change boards' }))
      await user.click(within(app('Claude')).getByRole('checkbox', { name: 'Marketing' }))

      await user.click(within(app('Claude')).getByRole('button', { name: 'Save' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
      expect(within(app('Claude')).getByRole('checkbox', { name: 'Marketing' })).toBeChecked()
      expect(within(app('Claude')).getByRole('button', { name: 'Save' })).toBeEnabled()
    })

    it('clears the error once a second try is saved', async () => {
      fakeApps()
      fakeEndpoint('patch', GRANT, () => HttpResponse.json({ detail: 'Server error' }, { status: 500 }))
      const { user } = renderDialog()
      await loaded()
      await user.click(within(app('Claude')).getByRole('button', { name: 'Change boards' }))
      await user.click(within(app('Claude')).getByRole('button', { name: 'Save' }))
      await screen.findByRole('alert')
      fakeEndpoint('patch', GRANT, () => HttpResponse.json(CLAUDE))

      await user.click(within(app('Claude')).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(within(app('Claude')).queryByRole('checkbox')).not.toBeInTheDocument())
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('takes nothing while saving', async () => {
      fakeApps()
      const held = heldAnswer(() => HttpResponse.json(CLAUDE))
      fakeEndpoint('patch', GRANT, held.answer)
      const { user } = renderDialog()
      await loaded()
      await user.click(within(app('Claude')).getByRole('button', { name: 'Change boards' }))

      await user.click(within(app('Claude')).getByRole('button', { name: 'Save' }))

      expect(within(app('Claude')).getByRole('button', { name: 'Save' })).toBeDisabled()
      expect(within(app('Claude')).getByRole('button', { name: 'Cancel' })).toBeDisabled()
      held.release()
      await waitFor(() => expect(within(app('Claude')).queryByRole('checkbox')).not.toBeInTheDocument())
    })
  })

  describe('revoking', () => {
    it('asks first', async () => {
      fakeApps()
      const revoked = fakeEndpoint('delete', GRANT)
      const { user } = renderDialog()
      await loaded()
      await user.click(within(app('Claude')).getByRole('button', { name: 'Revoke' }))
      expect(within(app('Claude')).getByText('Claude will lose access to your boards at once.')).toBeInTheDocument()
      expect(revoked.requests).toEqual([])
    })

    it('revokes once confirmed, and takes the app off the list', async () => {
      fakeApps()
      const revoked = fakeEndpoint('delete', GRANT)
      const { user } = renderDialog()
      await loaded()
      await user.click(within(app('Claude')).getByRole('button', { name: 'Revoke' }))

      await user.click(within(app('Claude')).getByRole('button', { name: 'Revoke' }))

      await waitFor(() => expect(screen.queryByText('Claude', { selector: 'p' })).not.toBeInTheDocument())
      expect(revoked.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/oauth/grants/grant-1'])
      expect(screen.getByText('Claude Code', { selector: 'p' })).toBeInTheDocument()
    })

    it('takes it off the list when it was already gone', async () => {
      fakeApps()
      fakeEndpoint('delete', GRANT, notFound)
      const { user } = renderDialog()
      await loaded()
      await user.click(within(app('Claude')).getByRole('button', { name: 'Revoke' }))
      await user.click(within(app('Claude')).getByRole('button', { name: 'Revoke' }))
      await waitFor(() => expect(screen.queryByText('Claude', { selector: 'p' })).not.toBeInTheDocument())
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it("says so, and keeps the app, when it can't be revoked", async () => {
      fakeApps()
      fakeEndpoint('delete', GRANT, () => HttpResponse.json({ detail: 'Server error' }, { status: 500 }))
      const { user } = renderDialog()
      await loaded()
      await user.click(within(app('Claude')).getByRole('button', { name: 'Revoke' }))
      await user.click(within(app('Claude')).getByRole('button', { name: 'Revoke' }))
      // The question is an alert too.
      expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
      expect(within(app('Claude')).getByText('Claude will lose access to your boards at once.')).toBeInTheDocument()
    })

    it('Cancel keeps the app', async () => {
      fakeApps()
      const revoked = fakeEndpoint('delete', GRANT)
      const { user } = renderDialog()
      await loaded()
      await user.click(within(app('Claude')).getByRole('button', { name: 'Revoke' }))
      await user.click(within(app('Claude')).getByRole('button', { name: 'Cancel' }))
      expect(within(app('Claude')).queryByText('Claude will lose access to your boards at once.')).not.toBeInTheDocument()
      expect(within(app('Claude')).getByRole('button', { name: 'Change boards' })).toBeInTheDocument()
      expect(revoked.requests).toEqual([])
    })

    it('takes nothing while revoking', async () => {
      fakeApps()
      const held = heldAnswer()
      fakeEndpoint('delete', GRANT, held.answer)
      const { user } = renderDialog()
      await loaded()
      await user.click(within(app('Claude')).getByRole('button', { name: 'Revoke' }))
      await user.click(within(app('Claude')).getByRole('button', { name: 'Revoke' }))
      expect(within(app('Claude')).getByRole('button', { name: 'Revoke' })).toBeDisabled()
      expect(within(app('Claude')).getByRole('button', { name: 'Cancel' })).toBeDisabled()
      held.release()
      await waitFor(() => expect(screen.queryByText('Claude', { selector: 'p' })).not.toBeInTheDocument())
    })

    it('asking to revoke one app closes the editor of another', async () => {
      fakeApps()
      const { user } = renderDialog()
      await loaded()
      await user.click(within(app('Claude Code')).getByRole('button', { name: 'Change boards' }))
      await user.click(within(app('Claude')).getByRole('button', { name: 'Revoke' }))
      expect(within(app('Claude Code')).queryByRole('checkbox')).not.toBeInTheDocument()
    })

    it('editing one app closes the revoke question of another', async () => {
      fakeApps()
      const { user } = renderDialog()
      await loaded()
      await user.click(within(app('Claude')).getByRole('button', { name: 'Revoke' }))
      await user.click(within(app('Claude Code')).getByRole('button', { name: 'Change boards' }))
      expect(screen.queryByText('Claude will lose access to your boards at once.')).not.toBeInTheDocument()
    })
  })

  describe('reopening', () => {
    it('loads the apps again', async () => {
      fakeApps()
      const { reopen } = renderDialog()
      await loaded()
      fakeApps({ grants: () => HttpResponse.json([CLAUDE_CODE]) })

      reopen()

      await loaded()
      expect(screen.queryByText('Claude', { selector: 'p' })).not.toBeInTheDocument()
    })

    it("doesn't show the last apps while loading them again", async () => {
      fakeApps()
      const { reopen } = renderDialog()
      await loaded()
      const held = heldAnswer(() => HttpResponse.json([CLAUDE_CODE]))
      fakeApps({ grants: held.answer })

      reopen()

      expect(screen.queryByText('Claude', { selector: 'p' })).not.toBeInTheDocument()
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
      held.release()
      await loaded()
    })

    it('drops a late answer for the last opening', async () => {
      const held = heldAnswer(() => HttpResponse.json([CLAUDE, CLAUDE_CODE]))
      const loads = fakeApps({ grants: held.answer })
      const { reopen } = renderDialog()
      await waitFor(() => expect(loads.grants.requests).toHaveLength(1))
      fakeApps({ grants: () => HttpResponse.json([CLAUDE_CODE]) })
      reopen()
      await loaded()

      held.release()

      // Gives the late answer time to land.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(screen.queryByText('Claude', { selector: 'p' })).not.toBeInTheDocument()
    })

    it('drops a late failure for the last opening', async () => {
      const held = heldAnswer(notFound)
      const loads = fakeApps({ grants: held.answer })
      const { reopen } = renderDialog()
      await waitFor(() => expect(loads.grants.requests).toHaveLength(1))
      fakeApps()
      reopen()
      await loaded()

      held.release()

      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('starts with no editor, question or error open', async () => {
      fakeApps()
      fakeEndpoint('delete', GRANT, () => HttpResponse.json({ detail: 'Server error' }, { status: 500 }))
      const { user, reopen } = renderDialog()
      await loaded()
      await user.click(within(app('Claude Code')).getByRole('button', { name: 'Change boards' }))
      await user.click(within(app('Claude')).getByRole('button', { name: 'Revoke' }))
      await user.click(within(app('Claude')).getByRole('button', { name: 'Revoke' }))
      await screen.findByText('Something went wrong. Please try again.')
      await user.click(within(app('Claude Code')).getByRole('button', { name: 'Change boards' }))

      reopen()

      await loaded()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
      expect(screen.queryByText('Claude will lose access to your boards at once.')).not.toBeInTheDocument()
    })

    it('starts with the revoke question closed', async () => {
      fakeApps()
      const { user, reopen } = renderDialog()
      await loaded()
      await user.click(within(app('Claude')).getByRole('button', { name: 'Revoke' }))

      reopen()

      await loaded()
      expect(screen.queryByText('Claude will lose access to your boards at once.')).not.toBeInTheDocument()
    })

    it('no longer says copied', async () => {
      fakeApps()
      const { user, reopen } = renderDialog()
      await user.click(screen.getByRole('button', { name: 'Copy address' }))
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Copied')

      reopen()
      await user.hover(screen.getByRole('button', { name: 'Copy address' }))

      await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Copy address'))
    })
  })

  it('closes on Close', async () => {
    fakeApps()
    const { user, onClose } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
