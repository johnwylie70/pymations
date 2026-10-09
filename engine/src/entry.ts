/**
 * Bundle entry (scripts/build-pymations.mjs → anim.js, an IIFE): sets
 * `window.__cirAnim` for the preview page. The bundle folder is wherever this
 * script was loaded from; opentype, KaTeX and the fonts sit beside it, and
 * `__cirAnimBase` tells the TeX outliner the same folder.
 */
import { createAnimEngine } from './engine'
import { texToOutlines } from './tex'

const g = globalThis as any
// The page sets __cirAnimBase before loading this; otherwise use this script's own folder.
const script = typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null) : null
const fromScript = script && script.src ? script.src.replace(/[^/]*$/, '') : '/preview-packages/pymations/'
const base: string = typeof g.__cirAnimBase === 'string' && g.__cirAnimBase
  ? (g.__cirAnimBase.endsWith('/') ? g.__cirAnimBase : g.__cirAnimBase + '/')
  : fromScript
g.__cirAnimBase = base
g.__cirAnim = createAnimEngine({ base, tex: texToOutlines })
