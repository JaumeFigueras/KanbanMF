import { createTheme } from '@mui/material/styles'

export const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
    background: {
      default: '#f5f5f5',
      paper: '#ffffff',
    },
  },
})

export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#9C27B0',        // purple[500]
      light: '#CE93D8',       // purple[200]
      dark: '#7B1FA2',        // purple[700]
      contrastText: '#ffffff',
    },
    divider: 'rgba(156, 39, 176, 0.5)',
    background: {
      default: '#121212',
      paper: '#1e1e1e',
    },
  },
})
