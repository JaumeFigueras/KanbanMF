// The one piece of Node's API the tests use (setup.ts), declared here rather
// than adding all of Node's types to the app's tsconfig, where they would
// change the types of browser globals such as setTimeout.
declare module 'node:buffer' {
  export const File: typeof globalThis.File
}
