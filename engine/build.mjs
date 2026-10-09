/**
 * Build the animation engine bundle from engine/src into
 * src/pymations/web/engine/ (or --out DIR):
 *
 *   anim.js            src/entry.ts as one script (sets window.__cirAnim)
 *   katex.min.js/.css  KaTeX, for MathTex/Tex outlines
 *   fonts/             KaTeX's .ttf + .woff2 and Liberation Sans for Text (both SIL OFL 1.1, licences beside them)
 *   opentype.min.js    glyph outlines from those fonts
 *
 *   cd engine && npm install && npm run build
 *
 * The usual way the bundle arrives is the sync from Circuitry
 * (circuitry/scripts/sync-pymations-lib.mjs), which builds it there with the
 * same steps; this is for working on the engine without Circuitry.
 * NODE_MODULES=/path/to/node_modules uses packages installed elsewhere.
 */

import { createRequire } from 'node:module'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const nm = resolve(process.env.NODE_MODULES || join(here, 'node_modules'))
const require = createRequire(join(nm, 'noop.js'))
const i = process.argv.indexOf('--out')
const out = resolve(i > 0 ? process.argv[i + 1] : join(here, '..', 'src/pymations/web/engine'))

function copy(from, to) {
  if (!existsSync(from)) throw new Error('missing ' + from + ' (npm install first)')
  copyFileSync(from, to)
}

const esbuild = require('esbuild')
mkdirSync(join(out, 'fonts'), { recursive: true })
await esbuild.build({
  entryPoints: [join(here, 'src/entry.ts')],
  outfile: join(out, 'anim.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2018',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
})
writeFileSync(join(out, 'anim.js'),
  '/* Pymations engine (MIT licence, John Wylie). Built from engine/src. Loads KaTeX and opentype.js beside it. */\n' +
  readFileSync(join(out, 'anim.js'), 'utf8'))

const katex = join(nm, 'katex/dist')
copy(join(katex, 'katex.min.js'), join(out, 'katex.min.js'))
copy(join(katex, 'katex.min.css'), join(out, 'katex.min.css'))
for (const f of readdirSync(join(katex, 'fonts'))) {
  if (f.endsWith('.ttf') || f.endsWith('.woff2')) copy(join(katex, 'fonts', f), join(out, 'fonts', f))
}
copy(join(nm, 'opentype.js/dist/opentype.min.js'), join(out, 'opentype.min.js'))
const lib = join(nm, 'pdfjs-dist/standard_fonts')
for (const f of ['LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf', 'LiberationSans-Italic.ttf', 'LiberationSans-BoldItalic.ttf']) {
  copy(join(lib, f), join(out, 'fonts', f))
}
copy(join(lib, 'LICENSE_LIBERATION'), join(out, 'fonts', 'LICENSE_LIBERATION.txt'))
copy(join(here, 'LICENSE_KATEX_FONTS.txt'), join(out, 'fonts', 'LICENSE_KATEX_FONTS.txt'))
console.log('Built ' + out)
