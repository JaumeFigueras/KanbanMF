import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage-reports']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // A browser that blocks site data throws on any use of its storage:
    // the app reaches it only through src/utils/storage.ts, which doesn't.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/utils/storage.ts', 'src/**/*.test.{ts,tsx}', 'src/test/**'],
    rules: {
      'no-restricted-globals': ['error',
        { name: 'localStorage', message: 'Use readStored/writeStored from src/utils/storage.ts.' },
        { name: 'sessionStorage', message: 'Use readStored/writeStored from src/utils/storage.ts.' },
      ],
      'no-restricted-properties': ['error',
        { object: 'window', property: 'localStorage', message: 'Use readStored/writeStored from src/utils/storage.ts.' },
        { object: 'window', property: 'sessionStorage', message: 'Use readStored/writeStored from src/utils/storage.ts.' },
      ],
    },
  },
])
