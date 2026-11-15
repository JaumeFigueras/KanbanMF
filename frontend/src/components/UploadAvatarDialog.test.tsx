import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse } from 'msw'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { renderWithProviders } from '../test/render'
import UploadAvatarDialog from './UploadAvatarDialog'

const AVATAR = '/api/v1/users/me/avatar'
const CURRENT = '/api/v1/users/user-1/avatar?v=1'

// jsdom has no blob URLs: each picked file gets a made-up one, and the tests
// check which were given back.
let created: string[]
const revoked = vi.fn()
beforeEach(() => {
  created = []
  revoked.mockClear()
  URL.createObjectURL = vi.fn(() => {
    created.push(`blob:avatar-${created.length + 1}`)
    return created[created.length - 1]
  })
  URL.revokeObjectURL = revoked
})
afterEach(() => {
  // @ts-expect-error -- jsdom doesn't have them; put it back that way.
  delete URL.createObjectURL
  // @ts-expect-error -- as above.
  delete URL.revokeObjectURL
})

function image(name = 'me.png', bytes = 2048, type = 'image/png') {
  return new File([new Uint8Array(bytes)], name, { type })
}

function renderDialog({ hasAvatar = false }: { hasAvatar?: boolean } = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const dialog = (open: boolean) => (
    <UploadAvatarDialog
      open={open}
      onClose={onClose}
      hasAvatar={hasAvatar}
      currentAvatarUrl={hasAvatar ? CURRENT : null}
      onSaved={onSaved}
    />
  )
  const result = renderWithProviders(dialog(true))
  // Closes the dialog and opens it again, as the app bar's menu does.
  function reopen() {
    result.rerender(dialog(false))
    result.rerender(dialog(true))
  }
  return { ...result, onClose, onSaved, reopen }
}

function chooseButton() {
  return screen.getByRole('button', { name: 'Choose image…' })
}

function preview() {
  return screen.queryByRole('img', { name: 'Avatar preview' })
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

describe('UploadAvatarDialog', () => {
  it('offers to upload one, with an empty preview, when there is none', () => {
    renderDialog({ hasAvatar: false })
    expect(screen.getByRole('dialog', { name: 'Upload avatar' })).toBeInTheDocument()
    expect(preview()).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove avatar' })).not.toBeInTheDocument()
    expect(button('Save')).toBeDisabled()
  })

  it('offers to change or remove it, showing it, when there is one', () => {
    renderDialog({ hasAvatar: true })
    expect(screen.getByRole('dialog', { name: 'Change / Remove avatar' })).toBeInTheDocument()
    expect(preview()).toHaveAttribute('src', CURRENT)
    expect(button('Remove avatar')).toBeEnabled()
  })

  it('previews a chosen image, with its name and size, ready to save', async () => {
    const { user } = renderDialog({ hasAvatar: true })
    await user.upload(chooseButton(), image('me.png', 2048))
    expect(preview()).toHaveAttribute('src', 'blob:avatar-1')
    expect(screen.getByText('me.png (2.0 KB)')).toBeInTheDocument()
    expect(button('Save')).toBeEnabled()
  })

  it('keeps the chosen image when the file picker is cancelled', async () => {
    // Cancelling the picker after a choice sends a change with no file.
    const { user } = renderDialog()
    await user.upload(chooseButton(), image('me.png'))
    await user.upload(chooseButton(), [])
    expect(preview()).toHaveAttribute('src', 'blob:avatar-1')
    expect(screen.getByText('me.png (2.0 KB)')).toBeInTheDocument()
    expect(button('Save')).toBeEnabled()
  })

  it('refuses a file that is not one of the four image types', async () => {
    // The file picker's filter is only a hint: "All files" gets past it.
    renderDialog()
    const user = userEvent.setup({ applyAccept: false })
    await user.upload(chooseButton(), image('notes.pdf', 2048, 'application/pdf'))
    expect(screen.getByRole('alert')).toHaveTextContent('Only image files are allowed (JPEG, PNG, WebP, GIF).')
    expect(preview()).not.toBeInTheDocument()
    expect(button('Save')).toBeDisabled()
  })

  it('takes an image of exactly 100 KB, and refuses one a byte larger', async () => {
    const { user } = renderDialog()
    await user.upload(chooseButton(), image('big.png', 100 * 1024 + 1))
    expect(screen.getByRole('alert')).toHaveTextContent('File is too large. Maximum size is 100 KB.')
    expect(button('Save')).toBeDisabled()

    await user.upload(chooseButton(), image('limit.png', 100 * 1024))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(button('Save')).toBeEnabled()
  })

  it('uploads the chosen image as a form, then tells the caller and closes', async () => {
    const uploaded = fakeEndpoint('put', AVATAR)
    const { user, onSaved, onClose } = renderDialog()
    await user.upload(chooseButton(), image('me.png', 2048))
    await user.click(button('Save'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSaved).toHaveBeenCalledTimes(1)
    const sent = (uploaded.requests[0].body as FormData).get('file') as File
    expect([uploaded.requests.length, sent.name, sent.size, sent.type]).toEqual([1, 'me.png', 2048, 'image/png'])
  })

  it.each([
    [413, 'File is too large. Maximum size is 100 KB.'],
    [415, 'Only image files are allowed (JPEG, PNG, WebP, GIF).'],
    [500, 'Something went wrong. Please try again.'],
  ])('says why, and stays open, when the upload is refused with %i', async (status, message) => {
    fakeEndpoint('put', AVATAR, () => new HttpResponse(null, { status }))
    const { user, onSaved, onClose } = renderDialog()
    await user.upload(chooseButton(), image())
    await user.click(button('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('removes the avatar, then tells the caller and closes', async () => {
    const removed = fakeEndpoint('delete', AVATAR)
    const { user, onSaved, onClose } = renderDialog({ hasAvatar: true })
    await user.click(button('Remove avatar'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(removed.requests).toHaveLength(1)
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('says so, and stays open, when removing fails', async () => {
    fakeEndpoint('delete', AVATAR, () => new HttpResponse(null, { status: 500 }))
    const { user, onSaved, onClose } = renderDialog({ hasAvatar: true })
    await user.click(button('Remove avatar'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('takes no other click while the upload runs', async () => {
    const held = heldAnswer()
    fakeEndpoint('put', AVATAR, held.answer)
    const { user, onClose } = renderDialog({ hasAvatar: true })
    await user.upload(chooseButton(), image())

    await user.click(button('Save'))
    for (const name of ['Save', 'Cancel', 'Remove avatar']) expect(button(name)).toBeDisabled()
    expect(chooseButton()).toHaveAttribute('aria-disabled', 'true')

    held.release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('takes no other click while the removal runs', async () => {
    const held = heldAnswer()
    fakeEndpoint('delete', AVATAR, held.answer)
    const { user, onClose } = renderDialog({ hasAvatar: true })

    await user.click(button('Remove avatar'))
    for (const name of ['Save', 'Cancel', 'Remove avatar']) expect(button(name)).toBeDisabled()

    held.release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it("gives back each preview's blob URL once it's replaced, and the last one when closed", async () => {
    const { user, unmount } = renderDialog()
    await user.upload(chooseButton(), image('one.png'))
    await user.upload(chooseButton(), image('two.png'))
    expect(revoked.mock.calls).toEqual([['blob:avatar-1']])

    unmount()

    expect(revoked.mock.calls).toEqual([['blob:avatar-1'], ['blob:avatar-2']])
  })

  it('reopens with no image chosen, and without the last error', async () => {
    const { user, reopen } = renderDialog({ hasAvatar: true })
    await user.upload(chooseButton(), image('me.png'))
    await user.upload(chooseButton(), image('big.png', 200 * 1024))
    await screen.findByRole('alert')

    reopen()

    expect(preview()).toHaveAttribute('src', CURRENT)
    expect(screen.queryByText(/me\.png/)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(button('Save')).toBeDisabled()
    expect(revoked).toHaveBeenCalledWith('blob:avatar-1')
  })

  it('closes on Cancel without uploading anything', async () => {
    const uploaded = fakeEndpoint('put', AVATAR)
    const { user, onClose } = renderDialog()
    await user.upload(chooseButton(), image())
    await user.click(button('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(uploaded.requests).toEqual([])
  })
})
