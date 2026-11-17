import { Avatar, ButtonBase, Tooltip } from '@mui/material'
import type { PersonSummary } from '../types/board'

interface Props {
  person: PersonSummary
  size?: number
  onClick?: () => void
  // What a click does, for screen readers (the tooltip shows the name);
  // the name itself when not given.
  actionLabel?: string
  // The person's name is written beside the avatar, so screen readers skip
  // the avatar rather than read the name twice.
  decorative?: boolean
}

export default function PersonAvatar({ person, size = 28, onClick, actionLabel, decorative = false }: Props) {
  const avatarSrc = person.has_avatar
    ? `/api/v1/users/${person.id}/avatar`
    : undefined

  const initials = person.initials
    ?? person.display_name.split(' ').map((w) => w[0]).join('').slice(0, 3).toUpperCase()

  // For screen readers: in a button, the button's name says it all; on its
  // own, the avatar is an image named after the person (initials or picture
  // alike, as the picture's own alt is empty).
  const named = onClick ? {} : decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': person.display_name }

  const avatar = (
    <Avatar
      src={avatarSrc}
      alt=""
      {...named}
      sx={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        fontWeight: 700,
        bgcolor: 'primary.main',
      }}
    >
      {initials}
    </Avatar>
  )

  return (
    <Tooltip title={person.display_name}>
      {onClick ? (
        // A button, so it can be reached and pressed from the keyboard.
        <ButtonBase
          onClick={onClick}
          aria-label={actionLabel ?? person.display_name}
          focusRipple
          sx={{ borderRadius: '50%' }}
        >
          {avatar}
        </ButtonBase>
      ) : avatar}
    </Tooltip>
  )
}
