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

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn()
    const { user } = renderWithProviders(<PersonAvatar person={makePerson({ display_name: 'Emma Wilson' })} onClick={onClick} />)
    await user.click(screen.getByLabelText('Emma Wilson'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
