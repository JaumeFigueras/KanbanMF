import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { makePerson } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import PersonAvatar from './PersonAvatar'

describe('PersonAvatar', () => {
  it('shows the initials the person chose', () => {
    renderWithProviders(<PersonAvatar person={makePerson({ display_name: 'Emma Wilson', initials: 'EMW' })} />)
    expect(screen.getByLabelText('Emma Wilson')).toHaveTextContent(/^EMW$/)
  })

  it('otherwise takes the first letters of the name, at most three', () => {
    renderWithProviders(<PersonAvatar person={makePerson({ display_name: 'anna maria de la fuente' })} />)
    expect(screen.getByLabelText('anna maria de la fuente')).toHaveTextContent(/^AMD$/)
  })

  it('shows their picture when they have one', () => {
    renderWithProviders(<PersonAvatar person={makePerson({ id: 'user-7', has_avatar: true })} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', '/api/v1/users/user-7/avatar')
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
      <PersonAvatar person={makePerson({ display_name: 'Emma Wilson' })} onClick={onClick} actionLabel="Remove Emma Wilson" />,
    )
    await user.click(screen.getByRole('button', { name: 'Remove Emma Wilson' }))
    expect(onClick).toHaveBeenCalledTimes(1)
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
