import { configuracion } from './config.mjs'
import {
  base,
  desdeDondeSalio,
  diffDeLaRama,
  diffStaged,
  enRevision,
  git,
  lineas,
  lineasAgregadas,
  lineasBorradas,
} from './git.mjs'
import { ESTADO, GUIAS, plural, sinBase } from './salida.mjs'

export const DONDE_POR_DEFECTO = Object.freeze({
  esquema: 'start/env.ts',
  ejemplo: '.env.example',
  consul: 'consul/consul.ts',
  interfaces: 'consul/interfaces.ts',
})
const LA_PONE_EL_DESPLIEGUE = new Set(['NODE_ENV'])
const DECLARACION = /^\s*([A-Z][A-Z0-9_]*)\s*:\s*Env\.schema\./
const OPCIONAL = /\.optional\(/
const AGREGADOS_O_CAMBIADOS = 'ACMR'
const SEPARADOR = ' · '
const SIN_REGISTRO = null

const REMEDIO_OPCIONAL = 'si es solo local, está bien; si va a dev, agregala'

function dondeSegunConfig() {
  const { esquema, ejemplo, registro } = configuracion().variables
  return Object.freeze({
    esquema,
    ejemplo,
    consul: registro?.mapeo ?? DONDE_POR_DEFECTO.consul,
    interfaces: registro?.interfaces ?? DONDE_POR_DEFECTO.interfaces,
    conRegistro: Boolean(registro),
  })
}

function remedioObligatoria(donde, conRegistro) {
  if (!conRegistro) return `agregala a ${donde.ejemplo}, o declarala .optional()`
  return `agregala a ${donde.ejemplo} y a ${donde.consul} con su campo en ${donde.interfaces}, o declarala .optional()`
}

function declaraciones(filas, esquema) {
  return filas
    .filter(({ ruta }) => ruta === esquema)
    .map(({ numero, texto }) => ({ numero, texto, clave: DECLARACION.exec(texto)?.[1] }))
    .filter(({ clave }) => clave)
}

function clavesNuevas(diff, esquema) {
  const previas = new Set(declaraciones(lineasBorradas(diff), esquema).map(({ clave }) => clave))
  return declaraciones(lineasAgregadas(diff), esquema)
    .filter(({ clave }) => !previas.has(clave) && !LA_PONE_EL_DESPLIEGUE.has(clave))
    .map(({ numero, texto, clave }) => ({ numero, clave, opcional: OPCIONAL.test(texto) }))
}

function campoEnConsul(consul, clave) {
  const mapeo = new RegExp(
    String.raw`\{\s*key:\s*['"]${clave}['"]\s*,\s*value:\s*(?:\w+\.)*(\w+)\s*\}`
  )
  return mapeo.exec(consul)?.[1] ?? null
}

function faltantesDeObligatoria({ clave, ejemplo, consul, interfaces }, donde) {
  const faltan = []
  if (!new RegExp(`^${clave}=`, 'm').test(ejemplo)) faltan.push(donde.ejemplo)
  if (consul === SIN_REGISTRO) return faltan
  const campo = campoEnConsul(consul, clave)
  if (campo === null) faltan.push(donde.consul)
  else if (!new RegExp(String.raw`^\s*${campo}\??\s*:`, 'm').test(interfaces))
    faltan.push(donde.interfaces)
  return faltan
}

function revisarClave({ numero, clave, opcional }, archivos, faltaObligatoria, donde) {
  const lugar = `${donde.esquema}:${numero}  ${clave}`
  if (opcional) {
    if (archivos.consul === SIN_REGISTRO) return null
    if (campoEnConsul(archivos.consul, clave) !== null) return null
    return {
      estado: ESTADO.AVISA,
      detalle: `${lugar} no está en Consul`,
      remedio: REMEDIO_OPCIONAL,
    }
  }
  const faltan = faltantesDeObligatoria({ clave, ...archivos }, donde)
  if (faltan.length === 0) return null
  return {
    estado: faltaObligatoria,
    detalle: `${lugar} obligatoria, falta en ${faltan.join(SEPARADOR)}`,
    remedio: remedioObligatoria(donde, archivos.consul !== SIN_REGISTRO),
  }
}

export function revisarVariables({
  rutas,
  diff,
  ejemplo,
  consul,
  interfaces,
  faltaObligatoria = ESTADO.AVISA,
  donde = DONDE_POR_DEFECTO,
}) {
  if (!rutas.includes(donde.esquema)) {
    return [{ estado: ESTADO.SALTADO, detalle: `saltado: ${donde.esquema} sin cambios` }]
  }
  const nuevas = clavesNuevas(diff, donde.esquema)
  if (nuevas.length === 0)
    return [{ estado: ESTADO.PASA, detalle: `0 claves nuevas en ${donde.esquema}` }]
  const archivos = { ejemplo, consul, interfaces }
  const problemas = nuevas
    .map((nueva) => revisarClave(nueva, archivos, faltaObligatoria, donde))
    .filter(Boolean)
  if (problemas.length > 0) return problemas
  return [
    {
      estado: ESTADO.PASA,
      detalle: `${plural(nuevas.length, 'clave nueva', 'claves nuevas')} en su lugar`,
    },
  ]
}

function delIndice(ruta) {
  const enElIndice = lineas(git('ls-files', '--', ruta)).length > 0
  return enElIndice ? git('show', `:${ruta}`) : ''
}

function revisarCon({ rutas, diff, leer, faltaObligatoria }) {
  const donde = dondeSegunConfig()
  if (!rutas.includes(donde.esquema))
    return revisarVariables({ rutas, diff: '', ejemplo: '', consul: '', interfaces: '', donde })
  return revisarVariables({
    rutas,
    diff: diff(),
    ejemplo: leer(donde.ejemplo),
    consul: donde.conRegistro ? leer(donde.consul) : SIN_REGISTRO,
    interfaces: donde.conRegistro ? leer(donde.interfaces) : '',
    faltaObligatoria,
    donde,
  })
}

function correr() {
  return revisarCon({
    rutas: lineas(git('diff', '--cached', '--name-only', `--diff-filter=${AGREGADOS_O_CAMBIADOS}`)),
    diff: () => diffStaged(AGREGADOS_O_CAMBIADOS),
    leer: delIndice,
    faltaObligatoria: ESTADO.AVISA,
  })
}

function correrAlSubir() {
  const desde = desdeDondeSalio()
  if (desde === null) return sinBase(base())
  const filtro = `--diff-filter=${AGREGADOS_O_CAMBIADOS}`
  return revisarCon({
    rutas: lineas(git('diff', '--name-only', '--no-renames', filtro, desde, 'HEAD')),
    diff: () => diffDeLaRama(desde, AGREGADOS_O_CAMBIADOS),
    leer: (ruta) => enRevision('HEAD', ruta),
    faltaObligatoria: ESTADO.FRENA,
  })
}

export const variables = Object.freeze({ nombre: 'variables', guia: GUIAS.VARIABLES, correr })
export const variablesAlSubir = Object.freeze({
  nombre: 'variables',
  guia: GUIAS.VARIABLES,
  correr: correrAlSubir,
})
