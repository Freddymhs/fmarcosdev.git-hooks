import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { ESTADO } from './salida.mjs'

const SCRIPT = 'check'
const PASO_DE_TESTS = /^test(?::|$)/
// npm 10 anuncia cada script con «> pkg@ver script»; npm 12, con «npm notice run pkg@ver script»
const ENCABEZADO_DE_NPM = /^(?:> |npm notice run )\S+@\S+ (\S+)$/gm
export const AVISO_DE_TESTS = '⚠ tests'
const AVISO_EN_LA_SALIDA = new RegExp(`^${AVISO_DE_TESTS} (.+)$`, 'm')
const RESUMENES_CONOCIDOS = Object.freeze([
  // Japa y Vitest: «Tests  3 passed, 2 failed (5)»
  {
    forma: /Tests\s+(\d+) passed(?:, \d+ failed)?[^(\n]*\((\d+)\)/,
    leer: ([, pasaron, total]) => ({ pasaron, total }),
  },
  // Jest: «Tests:  1 failed, 11 passed, 12 total»
  {
    forma: /Tests:\s+(?:\d+ \w+, )*?(\d+) passed(?:, \d+ \w+)*, (\d+) total/,
    leer: ([, pasaron, total]) => ({ pasaron, total }),
  },
  // node:test: «# tests 122» … «# pass 122»
  {
    forma: /^# tests (\d+)[\s\S]*?^# pass (\d+)/m,
    leer: ([, total, pasaron]) => ({ pasaron, total }),
  },
  // Mocha: «7 passing» y, si hay, «2 failing»
  {
    forma: /^\s*(\d+) passing\b(?:[\s\S]*?^\s*(\d+) failing\b)?/m,
    leer: ([, pasaron, fallaron = 0]) => ({ pasaron, total: Number(pasaron) + Number(fallaron) }),
  },
])

export function resumenDeTests(salida) {
  for (const { forma, leer } of RESUMENES_CONOCIDOS) {
    const coincidencia = forma.exec(salida)
    if (coincidencia) {
      const { pasaron, total } = leer(coincidencia)
      return { pasaron: Number(pasaron), total: Number(total) }
    }
  }
  return null
}
const COLOR_ANSI = new RegExp(String.raw`${String.fromCodePoint(27)}\[[0-9;]*m`, 'g')
const MEGABYTE = 1024 * 1024
const MAX_BUFFER = 256 * MEGABYTE
const SEPARADOR = ' · '
export const TESTS_SALTADOS = 'saltados'
const REMEDIO_FALTA_INFRA = 'levantá lo que falta y corré npm test antes del PR'
const REMEDIO_SIN_RESUMEN = 'corré npm test a mano: node ace necesita Node 22'

const SIN_SCRIPT = Object.freeze({
  estado: ESTADO.SALTADO,
  detalle: `saltado: el repo no tiene npm run ${SCRIPT}`,
})
const NO_ES_LO_QUE_SE_SUBE = Object.freeze({
  estado: ESTADO.SALTADO,
  detalle: 'no corre: lo que probaría no es lo que se sube',
})

export function sinColor(texto) {
  return texto.replace(COLOR_ANSI, '')
}

function tieneElScript() {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'))
  return Object.hasOwn(scripts ?? {}, SCRIPT)
}

function pasosDe(salida) {
  return [...salida.matchAll(ENCABEZADO_DE_NPM)]
    .map(([, paso]) => paso)
    .filter((paso) => paso !== SCRIPT)
}

function nombreDelPaso(paso, salida) {
  if (!PASO_DE_TESTS.test(paso)) return paso
  const aviso = AVISO_EN_LA_SALIDA.exec(salida)
  if (aviso) return `tests ${aviso[1]}`
  const resumen = resumenDeTests(salida)
  return resumen ? `tests ${resumen.pasaron}/${resumen.total}` : paso
}

export function filaDeCheck({ codigo, salida }) {
  const pasos = pasosDe(salida)
  if (codigo === 0) {
    const detalle = pasos.map((paso) => nombreDelPaso(paso, salida)).join(SEPARADOR)
    const aviso = AVISO_EN_LA_SALIDA.exec(salida)?.[1]
    if (aviso) {
      const remedio = aviso.startsWith(TESTS_SALTADOS) ? REMEDIO_FALTA_INFRA : REMEDIO_SIN_RESUMEN
      return { estado: ESTADO.AVISA, detalle, remedio }
    }
    return { estado: ESTADO.PASA, detalle }
  }
  const fallo = pasos.at(-1) ?? SCRIPT
  const antes = pasos.slice(0, -1)
  const despues = antes.length > 0 ? `, después de ${antes.join(SEPARADOR)}` : ''
  return {
    estado: ESTADO.FRENA,
    detalle: `falló en ${fallo}${despues}`,
    remedio: `npm run ${fallo}: ahí está el detalle`,
  }
}

function correr(previas = []) {
  if (previas.some(({ nombre, estado }) => nombre === 'limpio' && estado === ESTADO.FRENA))
    return NO_ES_LO_QUE_SE_SUBE
  if (!tieneElScript()) return SIN_SCRIPT
  const { status, stdout, stderr, error } = spawnSync('npm', ['run', SCRIPT], {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  })
  if (error) throw error
  return filaDeCheck({ codigo: status, salida: sinColor(`${stdout}${stderr}`) })
}

export const check = Object.freeze({ nombre: 'check', correr })
