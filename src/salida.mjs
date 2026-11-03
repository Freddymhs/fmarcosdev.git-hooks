import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { configuracion } from './config.mjs'

export function guiaUrl() {
  return configuracion().guiaUrl
}

export const GUIAS = Object.freeze({
  MENSAJE: Object.freeze({ nombre: 'mensaje', pagina: 'Mensaje y rama' }),
  SONAR: Object.freeze({ nombre: 'sonar', pagina: 'Reglas de Sonar' }),
  VARIABLES: Object.freeze({ nombre: 'variables', pagina: 'Variables de entorno' }),
  COBERTURA: Object.freeze({ nombre: 'cobertura', pagina: 'Cobertura' }),
})

export const ESTADO = Object.freeze({
  PASA: 'pasa',
  FRENA: 'frena',
  AVISA: 'avisa',
  SALTADO: 'saltado',
  SUBIDA: 'subida',
  ERROR: 'error',
})

export const SALIDA = Object.freeze({ LIMPIO: 0, ENCONTRO: 1, NO_PUDO: 2 })

const SIMBOLO = Object.freeze({
  [ESTADO.PASA]: '✔',
  [ESTADO.FRENA]: '✖',
  [ESTADO.AVISA]: '⚠',
  [ESTADO.SALTADO]: '–',
  [ESTADO.SUBIDA]: '⬆',
  [ESTADO.ERROR]: '✖',
})

const CODIGO_COLOR = Object.freeze({
  [ESTADO.PASA]: 32,
  [ESTADO.FRENA]: 31,
  [ESTADO.AVISA]: 33,
  [ESTADO.SALTADO]: 2,
  [ESTADO.SUBIDA]: 36,
  [ESTADO.ERROR]: 31,
})

const NECESITAN_REMEDIO = new Set([ESTADO.FRENA, ESTADO.AVISA, ESTADO.ERROR])
const ESC = String.fromCodePoint(27)
const ANCHO_NOMBRE = 12
const SEPARACION = 2
const SANGRIA = '  '
const SEGMENTOS_DEL_REPO = 2
const DECIMALES = 1
const MILISEGUNDOS_POR_SEGUNDO = 1000
const ACTIVADO = '1'
const ENTRE_RANGOS = ','
const MOTIVO_APAGADO = 'apagado en package.json (hooks.apagados)'
const REMEDIO_HOOK_ROTO = 'el hook tiene un defecto: avisá con esta salida completa'

export function nombreCorto(paquete) {
  return paquete.split('.').slice(-SEGMENTOS_DEL_REPO).join('.')
}

function nombreDelRepo() {
  const { name } = JSON.parse(readFileSync('package.json', 'utf8'))
  return nombreCorto(name)
}

export function sinBase(base) {
  return {
    estado: ESTADO.AVISA,
    detalle: `sin ${base}: no se pudo comparar`,
    remedio: `git fetch ${base.replace('/', ' ')} y repetí`,
  }
}

export function colorPorDefecto(entorno, flujo) {
  return Boolean(flujo.isTTY) && !entorno.NO_COLOR
}

export function plural(cantidad, singular, varios = `${singular}s`) {
  return `${cantidad} ${cantidad === 1 ? singular : varios}`
}

export function rangos(numeros) {
  const tramos = []
  for (const numero of numeros) {
    const ultimo = tramos.at(-1)
    if (ultimo && numero === ultimo.hasta + 1) ultimo.hasta = numero
    else tramos.push({ desde: numero, hasta: numero })
  }
  return tramos
    .map(({ desde, hasta }) => (desde === hasta ? `${desde}` : `${desde}-${hasta}`))
    .join(ENTRE_RANGOS)
}

function primeraLinea(error) {
  return String(error?.message ?? error).split('\n')[0]
}

function apagadosDe(apagados) {
  return new Set(apagados.map((nombre) => String(nombre).trim()))
}

function defectoDe(fila) {
  if (!Object.hasOwn(SIMBOLO, fila?.estado)) return `estado desconocido: ${fila?.estado}`
  if (NECESITAN_REMEDIO.has(fila.estado) && !fila.remedio) {
    return `fila ${SIMBOLO[fila.estado]} sin remedio`
  }
  if (fila.estado === ESTADO.SALTADO && !fila.detalle) return 'fila – sin motivo'
  return null
}

function filaQueNoCorrio(motivo, remedio) {
  return { estado: ESTADO.ERROR, detalle: `no pudo correr: ${motivo}`, remedio }
}

async function filasDe(chequeo, apagados, previas) {
  if (apagados.has(chequeo.clave ?? chequeo.nombre) || apagados.has(chequeo.nombre)) {
    return [{ estado: ESTADO.SALTADO, detalle: MOTIVO_APAGADO }]
  }
  try {
    const filas = [await chequeo.correr(previas)].flat()
    const defecto =
      filas.length === 0 ? 'sin filas' : filas.map((fila) => defectoDe(fila)).find(Boolean)
    return defecto ? [filaQueNoCorrio(defecto, REMEDIO_HOOK_ROTO)] : filas
  } catch (error) {
    return [filaQueNoCorrio(primeraLinea(error), chequeo.remedioSiNoCorre ?? REMEDIO_HOOK_ROTO)]
  }
}

function pintar(texto, estado, color) {
  return color ? `${ESC}[${CODIGO_COLOR[estado]}m${texto}${ESC}[0m` : texto
}

function lineaDeFila(fila, color) {
  const simbolo = pintar(SIMBOLO[fila.estado], fila.estado, color)
  return `${simbolo} ${fila.nombre.padEnd(ANCHO_NOMBRE)} ${fila.detalle ?? ''}`
}

function contar(filas, estado) {
  return filas.filter((fila) => fila.estado === estado).length
}

function veredicto(filas, segundos, color) {
  const tiempo = `${segundos.toFixed(DECIMALES)} s`
  const problemas = contar(filas, ESTADO.FRENA)
  const avisos = contar(filas, ESTADO.AVISA)
  const textoAvisos =
    avisos > 0 ? `${pintar('⚠', ESTADO.AVISA, color)} ${plural(avisos, 'aviso')}` : null
  const frena = pintar(SIMBOLO[ESTADO.FRENA], ESTADO.FRENA, color)
  const pasa = pintar(SIMBOLO[ESTADO.PASA], ESTADO.PASA, color)
  if (contar(filas, ESTADO.ERROR) > 0) return `${frena} no pudo correr · exit ${SALIDA.NO_PUDO}`
  if (problemas > 0) {
    return [`${frena} ${plural(problemas, 'problema')}`, textoAvisos, tiempo]
      .filter(Boolean)
      .join(' · ')
  }
  return [pasa, [textoAvisos, tiempo].filter(Boolean).join(' · ')].join(' ')
}

function destinoDe(guia) {
  return guia ? `guía: ${guia.nombre}` : 'índice'
}

function urlsDe(pendientes, url) {
  if (!url) return []
  const indice = pendientes.some(({ guia }) => !guia) ? [`${SANGRIA}índice: ${url}`] : []
  const guias = new Map(
    pendientes.filter(({ guia }) => guia).map(({ guia }) => [guia.nombre, guia])
  )
  const deGuias = [...guias.values()].map(
    ({ nombre, pagina }) => `${SANGRIA}${nombre}: ${enlaceDeGuia(url, pagina)}`
  )
  return [...indice, ...deGuias]
}

const ARCHIVO_MARKDOWN = /\.md$/i
const NO_ALFANUMERICO = /[^\p{L}\p{N}]+/gu

function enlaceDeGuia(url, pagina) {
  if (!ARCHIVO_MARKDOWN.test(url)) return `${url}/${encodeURIComponent(pagina)}`
  return `${url}#${pagina.toLowerCase().replaceAll(NO_ALFANUMERICO, '-')}`
}

function queHago(filas, url) {
  const porRemedio = new Map()
  for (const fila of filas) {
    const clave = `${fila.nombre}\t${fila.remedio}`
    if (NECESITAN_REMEDIO.has(fila.estado) && !porRemedio.has(clave)) porRemedio.set(clave, fila)
  }
  const pendientes = [...porRemedio.values()]
  if (pendientes.length === 0) return []
  const anchoNombre = Math.max(...pendientes.map(({ nombre }) => nombre.length)) + SEPARACION
  const anchoRemedio = Math.max(...pendientes.map(({ remedio }) => remedio.length)) + SEPARACION
  const remedios = pendientes.map(
    ({ nombre, remedio, guia }) =>
      `${SANGRIA}${nombre.padEnd(anchoNombre)}${remedio.padEnd(anchoRemedio)}${destinoDe(guia)}`
  )
  return [...remedios, ...urlsDe(pendientes, url)]
}

function componer({ encabezado, filas, segundos, color, verbose, url }) {
  const grilla = filas
    .filter((fila) => verbose || !fila.soloVerbose)
    .map((fila) => lineaDeFila(fila, color))
  const lineas = [
    encabezado,
    '',
    ...grilla,
    '',
    veredicto(filas, segundos, color),
    ...queHago(filas, url),
  ]
  return `${lineas.join('\n')}\n`
}

async function revisar({ etapa, contexto, chequeos, repo, entorno, color, reloj, url, apagados }) {
  const inicio = reloj()
  const encabezado = ['husky', etapa, repo ?? nombreDelRepo(), contexto?.()]
    .filter(Boolean)
    .join(' · ')
  const apagar = apagadosDe(apagados)
  const filas = []
  for (const chequeo of chequeos()) {
    const propias = await filasDe(chequeo, apagar, [...filas])
    filas.push(...propias.map((fila) => ({ ...fila, nombre: chequeo.nombre, guia: chequeo.guia })))
  }
  const segundos = (reloj() - inicio) / MILISEGUNDOS_POR_SEGUNDO
  const verbose = entorno.HOOKS_VERBOSE === ACTIVADO
  return {
    texto: componer({ encabezado, filas, segundos, color, verbose, url }),
    codigo: codigoDeSalida(filas),
  }
}

function codigoDeSalida(filas) {
  if (contar(filas, ESTADO.ERROR) > 0) return SALIDA.NO_PUDO
  if (contar(filas, ESTADO.FRENA) > 0) return SALIDA.ENCONTRO
  return SALIDA.LIMPIO
}

export async function ejecutar({
  etapa,
  contexto,
  chequeos,
  repo,
  entorno = process.env,
  color = colorPorDefecto(entorno, process.stdout),
  escribir = (texto) => process.stdout.write(texto),
  reloj = () => performance.now(),
  url = guiaUrl(),
  apagados = configuracion().apagados,
}) {
  try {
    const { texto, codigo } = await revisar({
      etapa,
      contexto,
      chequeos,
      repo,
      entorno,
      color,
      reloj,
      url,
      apagados,
    })
    escribir(texto)
    return codigo
  } catch (error) {
    escribir(`✖ husky · ${etapa} no pudo correr: ${primeraLinea(error)}\n`)
    return SALIDA.NO_PUDO
  }
}
