// The line coverage of the app's own code that an end-to-end run reached in
// the browser, for `make test-e2e-cov`: the V8 coverage each page left in
// test-results/coverage/ (see conftest.py), mapped back to frontend/src
// through the build's source maps by ast-v8-to-istanbul, as Vitest's own
// coverage does. Prints each file below 100 % with its lines never run, and
// keeps the merged data in test-results/coverage/coverage-final.json.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const frontend = fileURLToPath(new URL('../frontend/', import.meta.url))
const coverage = fileURLToPath(new URL('test-results/coverage/', import.meta.url))
const build = join(coverage, 'build', 'assets')
const src = join(frontend, 'src')

// The tools Vitest's coverage already installed in frontend/.
const load = (file) => import(pathToFileURL(join(frontend, 'node_modules', file)).href)
const { convert } = await load('ast-v8-to-istanbul/dist/index.mjs')
const { parseAstAsync } = await load('vite/dist/node/index.js')
const { createCoverageMap } = await load('@vitest/istanbul-lib-coverage/dist/index.mjs')

const scripts = new Map() // each built file's code, AST and source map, read once
async function script(name) {
  if (!scripts.has(name)) {
    const code = readFileSync(join(build, name), 'utf8')
    const sourceMap = JSON.parse(readFileSync(join(build, `${name}.map`), 'utf8'))
    scripts.set(name, { code, ast: await parseAstAsync(code), sourceMap })
  }
  return scripts.get(name)
}

const merged = createCoverageMap({})
for (const file of readdirSync(coverage).filter((f) => f.endsWith('.json') && f !== 'coverage-final.json')) {
  for (const { url, functions } of JSON.parse(readFileSync(join(coverage, file), 'utf8'))) {
    const name = basename(new URL(url).pathname)
    const { code, ast, sourceMap } = await script(name)
    const data = await convert({ code, ast, sourceMap, wrapperLength: 0,
      coverage: { url: pathToFileURL(join(build, name)).href, functions } })
    merged.merge(Object.fromEntries(Object.entries(data).filter(([path]) => path.startsWith(src))))
  }
}
writeFileSync(join(coverage, 'coverage-final.json'), JSON.stringify(merged.toJSON()))

// 3, 4, 5, 9 → "3-5, 9"
function ranges(lines) {
  const out = []
  for (const line of lines) {
    const last = out.at(-1)
    if (last && line === last[1] + 1) last[1] = line
    else out.push([line, line])
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ')
}

for (const path of merged.files().sort()) {
  const file = merged.fileCoverageFor(path)
  const { pct } = file.toSummary().lines
  const unrun = ranges(file.getUncoveredLines().map(Number))
  if (pct < 100) console.log(`${relative(frontend, path)}  ${pct.toFixed(1)} %  ${unrun}`)
}
const { lines } = merged.getCoverageSummary()
console.log(`Lines: ${lines.covered}/${lines.total} (${lines.pct.toFixed(1)} %)`)
