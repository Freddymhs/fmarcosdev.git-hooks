import { existsSync } from 'node:fs'
import { ESTADO, GUIAS, plural, rangos } from './salida.mjs'

const CONFIG_SONAR = 'eslint.sonar.config.js'
const ENTRE_MEDIDAS = ' · '

const SIN_TS = Object.freeze({ estado: ESTADO.SALTADO, detalle: 'saltado: ningún .ts staged' })
const SIN_CONFIG = Object.freeze({
  estado: ESTADO.SALTADO,
  detalle: `saltado: sin ${CONFIG_SONAR}`,
})
const REMEDIO_EMPEORA =
  'en el commit avisa; al pushear frena: corregilo antes con npm run lint:sonar'
const REMEDIO_NO_CORRE = 'npm install con Node 22 y repetí el commit; a mano: npm run lint:sonar'

function lineasDe(lineasNuevas) {
  const numeros = [...new Set(lineasNuevas.map(({ line }) => line))].sort((una, otra) => una - otra)
  return numeros.length > 0 ? `:${rangos(numeros)}` : ''
}

function filaDelPeor({ ruta, subieron, complejidadSubio, antes, ahora, lineasNuevas }) {
  const reglas = subieron.map(({ regla, previo, cantidad }) => `${regla} ${previo} → ${cantidad}`)
  const complejidad = complejidadSubio
    ? [`complejidad ${antes.complejidad} → ${ahora.complejidad}`]
    : []
  return {
    estado: ESTADO.AVISA,
    detalle: `${ruta}${lineasDe(lineasNuevas)}  ${[...reglas, ...complejidad].join(ENTRE_MEDIDAS)}`,
    remedio: REMEDIO_EMPEORA,
  }
}

export function filasDeSonar({ archivos, peores }) {
  if (archivos.length === 0) return [SIN_TS]
  if (peores.length > 0) return peores.map((peor) => filaDelPeor(peor))
  const revisados = plural(archivos.length, 'archivo .ts', 'archivos .ts')
  return [{ estado: ESTADO.PASA, detalle: `0 issues nuevos contra HEAD en ${revisados}` }]
}

async function correr() {
  if (!existsSync(CONFIG_SONAR)) return SIN_CONFIG
  const { medir } = await import('./sonar_check.mjs')
  return filasDeSonar(await medir())
}

export const sonar = Object.freeze({
  nombre: 'sonar',
  guia: GUIAS.SONAR,
  remedioSiNoCorre: REMEDIO_NO_CORRE,
  correr,
})
