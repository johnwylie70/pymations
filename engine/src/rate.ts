/**
 * Rate functions, by the names Manim scripts use. Each maps progress 0..1 to
 * eased progress; `there_and_back` and friends return to 0 at the end.
 * Written from the published formulas (sigmoid smooth, Bézier running start,
 * and the standard easing curves).
 */
export type RateFn = (t: number) => number

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

export function smooth(t: number, inflection = 10): number {
  const err = sigmoid(-inflection / 2)
  return clamp01((sigmoid(inflection * (t - 0.5)) - err) / (1 - 2 * err))
}

export const linear: RateFn = t => t

export function thereAndBack(t: number): number {
  return smooth(t < 0.5 ? 2 * t : 2 * (1 - t))
}

/** A Bézier polynomial through control values (for running_start). */
function bezier1(vals: number[], t: number): number {
  const n = vals.length - 1
  let out = 0, c = 1
  for (let k = 0; k <= n; k++) {
    if (k > 0) c = (c * (n - k + 1)) / k
    out += c * Math.pow(1 - t, n - k) * Math.pow(t, k) * vals[k]
  }
  return out
}

const PI = Math.PI
const c1 = 1.70158, c2 = c1 * 1.525, c3 = c1 + 1, c4 = (2 * PI) / 3, c5 = (2 * PI) / 4.5

function bounceOut(t: number): number {
  const n1 = 7.5625, d1 = 2.75
  if (t < 1 / d1) return n1 * t * t
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
  return n1 * (t -= 2.625 / d1) * t + 0.984375
}

const RATES: Record<string, RateFn> = {
  linear,
  smooth: t => smooth(t),
  smoothstep: t => (t <= 0 ? 0 : t >= 1 ? 1 : 3 * t * t - 2 * t * t * t),
  smootherstep: t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (10 - 15 * t + 6 * t * t)),
  smoothererstep: t => (t <= 0 ? 0 : t >= 1 ? 1 : t ** 4 * (35 - 84 * t + 70 * t * t - 20 * t * t * t)),
  rush_into: t => 2 * smooth(t / 2),
  rush_from: t => 2 * smooth(t / 2 + 0.5) - 1,
  slow_into: t => Math.sqrt(1 - (1 - t) * (1 - t)),
  double_smooth: t => (t < 0.5 ? 0.5 * smooth(2 * t) : 0.5 * (1 + smooth(2 * t - 1))),
  there_and_back: thereAndBack,
  there_and_back_with_pause: t => {
    const p = 1 / 3, a = 1 / p
    if (t < 0.5 - p / 2) return smooth(a * t)
    if (t < 0.5 + p / 2) return 1
    return smooth(a - a * t)
  },
  running_start: t => bezier1([0, 0, -0.5, -0.5, 1, 1, 1], t),
  not_quite_there: t => 0.7 * smooth(t),
  wiggle: t => thereAndBack(t) * Math.sin(2 * PI * t),
  lingering: t => (t < 0.8 ? t / 0.8 : 1),
  exponential_decay: t => 1 - Math.exp(-t / 0.1),

  ease_in_sine: t => 1 - Math.cos((t * PI) / 2),
  ease_out_sine: t => Math.sin((t * PI) / 2),
  ease_in_out_sine: t => -(Math.cos(PI * t) - 1) / 2,
  ease_in_quad: t => t * t,
  ease_out_quad: t => 1 - (1 - t) * (1 - t),
  ease_in_out_quad: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  ease_in_cubic: t => t * t * t,
  ease_out_cubic: t => 1 - Math.pow(1 - t, 3),
  ease_in_out_cubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  ease_in_quart: t => t ** 4,
  ease_out_quart: t => 1 - Math.pow(1 - t, 4),
  ease_in_out_quart: t => (t < 0.5 ? 8 * t ** 4 : 1 - Math.pow(-2 * t + 2, 4) / 2),
  ease_in_quint: t => t ** 5,
  ease_out_quint: t => 1 - Math.pow(1 - t, 5),
  ease_in_out_quint: t => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  ease_in_expo: t => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  ease_out_expo: t => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  ease_in_out_expo: t =>
    t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  ease_in_circ: t => 1 - Math.sqrt(1 - t * t),
  ease_out_circ: t => Math.sqrt(1 - Math.pow(t - 1, 2)),
  ease_in_out_circ: t =>
    t < 0.5 ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2 : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2,
  ease_in_back: t => c3 * t * t * t - c1 * t * t,
  ease_out_back: t => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
  ease_in_out_back: t =>
    t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2,
  ease_in_elastic: t =>
    t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4),
  ease_out_elastic: t =>
    t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1,
  ease_in_out_elastic: t =>
    t === 0 ? 0 : t === 1 ? 1 : t < 0.5
      ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
      : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1,
  ease_in_bounce: t => 1 - bounceOut(1 - t),
  ease_out_bounce: bounceOut,
  ease_in_out_bounce: t => (t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2),
}

/** A Python rate function sampled at 65 evenly spaced points, played back piecewise linearly. */
function sampled(samples: number[]): RateFn {
  const n = samples.length - 1
  return t => {
    if (t <= 0) return samples[0]
    if (t >= 1) return samples[n]
    const x = t * n, i = Math.floor(x)
    return samples[i] + (samples[i + 1] - samples[i]) * (x - i)
  }
}

/**
 * A rate function by name ("smooth", "rate_functions.linear", "easeInOutSine"
 * all work), or {samples: [...]} for a function written in Python; unknown →
 * fallback.
 */
export function rateByName(name: unknown, fallback: RateFn = RATES.smooth): RateFn {
  if (name && typeof name === 'object' && Array.isArray((name as { samples?: unknown }).samples)) {
    const s = (name as { samples: unknown[] }).samples.map(Number)
    if (s.length >= 2) return sampled(s)
  }
  if (typeof name !== 'string' || !name) return fallback
  let key = name.replace(/^rate_functions\./, '').replace(/^rate_func\./, '')
  key = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
  const f = RATES[key]
  if (!f) return fallback
  // Outside 0..1 every rate holds its end value (there_and_back & co. are 0 there).
  // exponential_decay never quite reaches 1 inside the range, but is 1 past it.
  if (key === 'exponential_decay') return t => (t > 1 ? 1 : f(t < 0 ? 0 : t))
  return t => f(t < 0 ? 0 : t > 1 ? 1 : t)
}

export const RATE_NAMES = Object.keys(RATES)
