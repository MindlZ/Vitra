import { useEffect, useRef, useState } from 'react'
import type { Appearance } from '@shared/types'
import { pace } from '../lib/pace'
import { readPalette } from '../lib/theme'

// the PS3/PSP menu wave: a few glowing ribbons, each a sum of slow sines, with a
// faint sheet hanging under it. one fragment shader at half resolution; the
// ribbons are soft, so the upscale doesn't show

const FRAME_MS = 1000 / 30
const SLOW_FRAME_MS = 1000 / 10
const SCALE = 0.5
const FADE_MS = 900

const VERTEX = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`

// premultiplied out: the canvas composites over the wallpaper
const FRAGMENT = `
precision mediump float;
uniform vec2 res;
uniform float time;
uniform vec3 accent;
uniform vec3 tint;
uniform float light;
// the band's middle, as a fraction of the height from the bottom
uniform float centre;

// stays within ~0.08 of the centre, clear of the visualiser above it
float ribbon(float x, float i, float t) {
  return centre + (i - 1.5) * 0.012
    + 0.05 * sin(x * 1.5 + t * 0.11 + i * 0.85)
    + 0.022 * sin(x * 3.4 - t * 0.17 + i * 1.9)
    + 0.008 * sin(x * 7.3 + t * 0.29 + i * 2.6);
}

void main() {
  vec2 uv = gl_FragCoord.xy / res;
  // x in screen heights, so the curve keeps its shape on wide windows
  float x = uv.x * res.x / res.y;
  float t = time;
  float glow = 0.0;
  float core = 0.0;
  for (int n = 0; n < 4; n++) {
    float i = float(n);
    float y = ribbon(x, i, t);
    float d = uv.y - y;
    float w = 0.0018 + i * 0.0007;
    core += exp(-(d * d) / (w * w)) * (0.5 - i * 0.08);
    glow += exp(-abs(d) / (0.035 + i * 0.01)) * 0.06;
    // the sheet: fades out downwards from each line
    glow += d < 0.0 ? exp(d / (0.10 + i * 0.03)) * 0.03 : 0.0;
  }

  // the broad band (the PSP's): soft bright rims, nearly clear in the middle.
  // its width breathes along its length
  float mid = centre + 0.004
    + 0.03 * sin(x * 1.15 + t * 0.075 + 4.0)
    + 0.012 * sin(x * 2.6 - t * 0.12 + 1.3);
  float bandHalf = 0.058 + 0.016 * sin(x * 1.9 + t * 0.09 + 2.0);
  float bd = abs(uv.y - mid);
  float inside = 1.0 - smoothstep(bandHalf - 0.003, bandHalf + 0.003, bd);
  float edgeness = clamp(bd / bandHalf, 0.0, 1.0);
  glow += inside * (0.04 + edgeness * edgeness * 0.26);
  glow += exp(-abs(bd - bandHalf) / 0.014) * 0.1;
  core += exp(-abs(bd - bandHalf) / 0.004) * 0.14;
  // softer at the window's edges, like the XMB's
  float edge = smoothstep(0.0, 0.18, uv.x) * smoothstep(1.0, 0.82, uv.x);
  float a = clamp((glow + core) * edge, 0.0, 1.0) * (light > 0.5 ? 0.8 : 1.0);
  // dark: cores run to the tint and near-white. light: the pale tint read as gaps
  // on the wash, so it stays the accent, a touch deeper at the core
  vec3 colour = light > 0.5
    ? accent * (1.0 - clamp(core, 0.0, 1.0) * 0.25)
    : mix(mix(accent, tint, clamp(core * 1.6, 0.0, 1.0)), vec3(1.0), clamp(core * 0.8, 0.0, 0.6));
  gl_FragColor = vec4(colour * a, a);
}
`

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[wave] shader:', gl.getShaderInfoLog(shader))
    return null
  }
  return shader
}

const toVec = (rgb: string): [number, number, number] => {
  const [r, g, b] = rgb.split(/\s+/).map(Number)
  return [r / 255, g / 255, b / 255]
}

interface Props {
  appearance: Appearance
  // fades out and stops drawing when false, rather than unmounting with a cut
  visible?: boolean
  // the band's middle, fraction of the height from the bottom: under each screen's visualiser
  centre?: number
  className?: string
}

export default function Wave({
  appearance,
  visible = true,
  centre = 0.24,
  className = 'vitra-backdrop__wave'
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [drawing, setDrawing] = useState(visible)
  // a dependency so a hot-reloaded shader edit rebuilds the program (it kept the old one)
  const fragmentSource = FRAGMENT

  // keeps drawing through the fade-out, then rests
  useEffect(() => {
    if (visible) {
      setDrawing(true)
      return
    }
    const timer = setTimeout(() => setDrawing(false), FADE_MS)
    return () => clearTimeout(timer)
  }, [visible])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !drawing) return
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true })
    if (!gl) return
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX)
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource)
    const program = gl.createProgram()
    if (!vertex || !fragment || !program) return
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return
    gl.useProgram(program)

    // one triangle that covers the screen
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const p = gl.getAttribLocation(program, 'p')
    gl.enableVertexAttribArray(p)
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0)

    const at = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name)
    const u = { res: at('res'), time: at('time'), accent: at('accent'), tint: at('tint'), light: at('light'), centre: at('centre') }

    const palette = (): void => {
      const { accent, tint } = readPalette(canvas)
      gl.uniform3fv(u.accent, toVec(accent))
      gl.uniform3fv(u.tint, toVec(tint))
      gl.uniform1f(u.light, appearance === 'light' ? 1 : 0)
      gl.uniform1f(u.centre, centre)
    }

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr * SCALE))
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr * SCALE))
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform2f(u.res, canvas.width, canvas.height)
    }

    // time starts somewhere random, so it isn't the same shape every launch
    const offset = Math.random() * 1000
    const draw = (ms: number): void => {
      gl.uniform1f(u.time, offset + ms / 1000)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    palette()
    resize()
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    let last = 0
    const tick = (time: number): void => {
      frame = requestAnimationFrame(tick)
      const speed = pace()
      if (speed === 'paused') return
      if (time - last < (speed === 'slow' ? SLOW_FRAME_MS : FRAME_MS) - 2) return
      last = time
      draw(time)
    }
    if (still) draw(0)
    else frame = requestAnimationFrame(tick)

    const onResize = (): void => {
      resize()
      if (still) draw(0)
    }
    const onPalette = (): void => {
      palette()
      if (still) draw(0)
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('vitra:palette', onPalette)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('vitra:palette', onPalette)
      // not loseContext(): the canvas hands back that same (dead) context next time
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
    }
  }, [appearance, drawing, centre, fragmentSource])

  return (
    <canvas
      ref={ref}
      className={className}
      style={{ opacity: visible ? 1 : 0, transition: `opacity ${FADE_MS}ms ease` }}
    />
  )
}
