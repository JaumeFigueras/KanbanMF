import { Avatar, Tooltip } from '@mui/material'
import type { PersonSummary } from '../types/board'

interface Props {
  person: PersonSummary
  size?: number
  onClick?: () => void
}

export default function PersonAvatar({ person, size = 28, onClick }: Props) {
  const avatarSrc = person.has_avatar
    ? `http://localhost:8000/api/v1/users/${person.id}/avatar`
    : undefined

  const initials = person.initials
    ?? person.display_name.split(' ').map((w) => w[0]).join('').slice(0, 3).toUpperCase()

  return (
    <Tooltip title={person.display_name}>
      <Avatar
        src={avatarSrc}
        onClick={onClick}
        sx={{
          width: size,
          height: size,
          fontSize: size * 0.4,
          fontWeight: 700,
          bgcolor: 'primary.main',
          cursor: onClick ? 'pointer' : undefined,
        }}
      >
        {initials}
      </Avatar>
    </Tooltip>
  )
}
