import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { makePerson } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import PersonAvatar from './PersonAvatar'

describe('PersonAvatar', () => {
  it('shows the initials the person chose', () => {
    renderWithProviders(<PersonAvatar person={makePerson({ display_name: 'Emma Wilson', initials: 'EMW' })} />)
    expect(screen.getByRole('img', { name: 'Emma Wilson' })).toHaveTextContent(/^EMW$/)
  })

  it('otherwise takes the first letters of the name, at most three', () => {
    renderWithProviders(<PersonAvatar person={makePerson({ display_name: 'anna maria de la fuente' })} />)
    expect(screen.getByRole('img', { name: 'anna maria de la fuente' })).toHaveTextContent(/^AMD$/)
  })

  it('shows their picture when they have one', () => {
    renderWithProviders(<PersonAvatar person={makePerson({ id: 'user-7', display_name: 'Liam Chen', has_avatar: true })} />)
    const picture = screen.getByRole('img', { name: 'Liam Chen' }).querySelector('img')
    expect(picture).toHaveAttribute('src', '/api/v1/users/user-7/avatar')
  })

  it('is one image named after the person for screen readers, picture or not', () => {
    renderWithProviders(
      <>
        <PersonAvatar person={makePerson({ display_name: 'Emma Wilson' })} />
        <PersonAvatar person={makePerson({ display_name: 'Liam Chen', has_avatar: true })} />
      </>,
    )
    // The picture itself has an empty alt, so it isn't a second, nameless one.
    expect(screen.getAllByRole('img').map((img) => img.getAttribute('aria-label'))).toEqual(['Emma Wilson', 'Liam Chen'])
    expect(document.querySelector('img')).toHaveAttribute('alt', '')
  })

  it("is hidden from screen readers when the person's name is written beside it", () => {
    renderWithProviders(
      <>
        <PersonAvatar person={makePerson({ display_name: 'Emma Wilson' })} decorative />
        <PersonAvatar person={makePerson({ display_name: 'Liam Chen', has_avatar: true })} decorative />
      </>,
    )
    expect(screen.queryAllByRole('img')).toEqual([])
    // Still drawn, for everyone else.
    expect(screen.getByText('EW')).toBeVisible()
  })

  it('shows their name on hover', async () => {
    const { user } = renderWithProviders(<PersonAvatar person={makePerson({ display_name: 'Emma Wilson' })} />)
    await user.hover(screen.getByLabelText('Emma Wilson'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Emma Wilson')
  })

  it('is no button when nothing happens on a click', () => {
    renderWithProviders(<PersonAvatar person={makePerson({ display_name: 'Emma Wilson' })} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('is a button, named by what a click does, when it does something', async () => {
    const onClick = vi.fn()
    const { user } = renderWithProviders(
      <PersonAvatar
        person={makePerson({ display_name: 'Emma Wilson', has_avatar: true })}
        onClick={onClick}
        actionLabel="Remove Emma Wilson"
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Remove Emma Wilson' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    // No image inside it to be read as well.
    expect(within(screen.getByRole('button')).queryByRole('img')).not.toBeInTheDocument()
  })

  it('is named by the person when what a click does is not given', () => {
    renderWithProviders(<PersonAvatar person={makePerson({ display_name: 'Emma Wilson' })} onClick={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Emma Wilson' })).toBeInTheDocument()
  })

  it('can be reached and pressed from the keyboard', async () => {
    const onClick = vi.fn()
    const { user } = renderWithProviders(<PersonAvatar person={makePerson()} onClick={onClick} />)
    await user.tab()
    expect(screen.getByRole('button')).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('still shows the name on hover when it is a button', async () => {
    const { user } = renderWithProviders(
      <PersonAvatar person={makePerson({ display_name: 'Emma Wilson' })} onClick={vi.fn()} actionLabel="Remove Emma Wilson" />,
    )
    await user.hover(screen.getByRole('button'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Emma Wilson')
  })

  it('shows the initials inside the button too', () => {
    renderWithProviders(<PersonAvatar person={makePerson({ initials: 'EMW' })} onClick={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveTextContent(/^EMW$/)
  })
})
