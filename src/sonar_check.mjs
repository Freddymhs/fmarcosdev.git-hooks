import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { ESLint } from 'eslint'

const MEGABYTE = 1024 * 1024
const MAX_BUFFER = 256 * MEGABYTE
const CONFIG_SONAR = 'eslint.sonar.config.js'
const EXTENSION_REVISADA = '.ts'
const SIN_REGLA = 'parseo'
const COMPLEJIDAD = /from (\d+) to the/
const MAX_LINEAS_POR_ARCHIVO = 8
const MAX_LARGO_MENSAJE = 110
const FALTA_MODULO = 'ERR_MODULE_NOT_FOUND'
const NO_PUDO_CORRER = 2
const CONTRA_HEAD = Object.freeze({
  nombre: 'HEAD',
  quien: 'el commit',
  rango: ['--cached'],
  actual: '',
  previa: 'HEAD',
})

function git(...args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  })
}

function archivoDeLinea(linea) {
  const [, anterior, renombrado] = linea.split('\t')
  return { ruta: renombrado ?? anterior, anterior }
}

function contraLaBase(base) {
  const desde = git('merge-base', base, 'HEAD').trim()
  return { nombre: base, quien: 'la rama', rango: [desde, 'HEAD'], actual: 'HEAD', previa: desde }
}

function tsCambiados({ rango }) {
  return git('diff', ...rango, '--name-status', '-M', '--diff-filter=ACMR')
    .split('\n')
    .filter((linea) => linea !== '')
    .map((linea) => archivoDeLinea(linea))
    .filter(({ ruta }) => ruta.endsWith(EXTENSION_REVISADA))
}

function versionEn(revision, ruta) {
  const existe = git('ls-tree', '--name-only', revision, '--', ruta).trim() !== ''
  return existe ? git('show', `${revision}:${ruta}`) : null
}

async function mensajesDe(eslint, codigo, ruta) {
  if (codigo === null) return []
  const [resultado] = await eslint.lintText(codigo, { filePath: ruta, warnIgnored: false })
  return resultado?.messages ?? []
}

function resumen(mensajes) {
  const porRegla = new Map()
  for (const { ruleId } of mensajes) {
    const regla = ruleId ?? SIN_REGLA
    porRegla.set(regla, (porRegla.get(regla) ?? 0) + 1)
  }
  const complejidad = mensajes
    .map(({ message }) => Number(COMPLEJIDAD.exec(message)?.[1] ?? 0))
    .reduce((total, valor) => total + valor, 0)
  return { porRegla, complejidad }
}

function reglasQueSubieron(antes, ahora) {
  return [...ahora.porRegla]
    .map(([regla, cantidad]) => ({ regla, previo: antes.porRegla.get(regla) ?? 0, cantidad }))
    .filter(({ previo, cantidad }) => cantidad > previo)
}

async function revisarArchivo(eslint, { ruta, anterior }, comparacion) {
  const actuales = await mensajesDe(eslint, git('show', `${comparacion.actual}:${ruta}`), ruta)
  const previos = await mensajesDe(eslint, versionEn(comparacion.previa, anterior), ruta)
  const antes = resumen(previos)
  const ahora = resumen(actuales)
  const subieron = reglasQueSubieron(antes, ahora)
  const complejidadSubio = ahora.complejidad > antes.complejidad
  if (subieron.length === 0 && !complejidadSubio) return null
  const reglasNuevas = new Set(subieron.map(({ regla }) => regla))
  const lineasNuevas = actuales.filter(({ ruleId }) => reglasNuevas.has(ruleId ?? SIN_REGLA))
  return { ruta, subieron, complejidadSubio, antes, ahora, lineasNuevas }
}

export function informar({ ruta, subieron, complejidadSubio, antes, ahora, lineasNuevas }) {
  console.error(`⛔ ${ruta}`)
  for (const { regla, previo, cantidad } of subieron) {
    console.error(`     ${regla}: ${previo} → ${cantidad}`)
  }
  if (complejidadSubio) {
    console.error(`     complejidad cognitiva total: ${antes.complejidad} → ${ahora.complejidad}`)
  }
  for (const { line, message } of lineasNuevas.slice(0, MAX_LINEAS_POR_ARCHIVO)) {
    console.error(`     l.${line} ${message.slice(0, MAX_LARGO_MENSAJE)}`)
  }
}

export async function medir({ config = CONFIG_SONAR, base = null } = {}) {
  const comparacion = base ? contraLaBase(base) : CONTRA_HEAD
  const archivos = tsCambiados(comparacion)
  const eslint = new ESLint({ overrideConfigFile: config })
  const peores = []
  for (const archivo of archivos) {
    const peor = await revisarArchivo(eslint, archivo, comparacion)
    if (peor !== null) peores.push(peor)
  }
  return { archivos, peores, comparacion }
}

async function revisar({ script, config, que, base }) {
  const { archivos, peores, comparacion } = await medir({ config, base })
  const { nombre, quien } = comparacion
  if (peores.length === 0) {
    console.log(
      `${script}: ${archivos.length} archivos .ts revisados contra ${nombre}, ninguno suma ${que}`
    )
    return
  }
  for (const peor of peores) informar(peor)
  console.error(
    `⛔ ${quien} agrega ${que} contra ${nombre} en ${peores.length} de ${archivos.length} archivos .ts`
  )
  process.exitCode = 1
}

export async function correrComoScript({ script, config, que, aMano }) {
  const { values } = parseArgs({ options: { base: { type: 'string' } } })
  try {
    await revisar({ script, config, que, base: values.base ?? null })
  } catch (error) {
    const arreglo = error?.code === FALTA_MODULO ? 'npm install' : `revisalo a mano con ${aMano}`
    console.error(
      `✖ ${script} no pudo correr: ${String(error?.message ?? error).split('\n')[0]} → ${arreglo}`
    )
    process.exitCode = NO_PUDO_CORRER
  }
}

// el pre-commit lo importa por medir(); corre solo y frena cuando se lo llama directo, como en check al pushear
if (process.argv[1] === import.meta.filename) {
  await correrComoScript({
    script: 'sonar_check',
    config: CONFIG_SONAR,
    que: 'issues de Sonar',
    aMano: 'npm run lint:sonar',
  })
}
