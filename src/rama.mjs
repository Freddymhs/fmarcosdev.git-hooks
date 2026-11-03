import { configuracion } from './config.mjs'
import { base, git, hayBase, lineas, ramaActual } from './git.mjs'
import { taskDeLaRama } from './mensaje.mjs'
import { ESTADO, GUIAS, plural, sinBase } from './salida.mjs'

const SIN_AGREGAR = '??'
const ANCHO_DEL_ESTADO = 3
const RENOMBRADO = ' -> '
const SEPARADOR = ' · '

const REMEDIO_SIN_AGREGAR = 'si va en el push, agregalo y commitealo; si es solo tuyo, está bien'
const REMEDIO_RAMA = 'el nombre lleva la task: feature/<task>_<descripción>'

function rutaDe(linea) {
  return linea.slice(ANCHO_DEL_ESTADO).split(RENOMBRADO).at(-1)
}

function revisarLimpio() {
  const cambios = lineas(git('status', '--porcelain=v1', '--untracked-files=all'))
  const sinAgregar = cambios
    .filter((linea) => linea.startsWith(SIN_AGREGAR))
    .map((linea) => rutaDe(linea))
  const trackeados = cambios
    .filter((linea) => !linea.startsWith(SIN_AGREGAR))
    .map((linea) => rutaDe(linea))
  const filas = []
  if (trackeados.length > 0) {
    const lista = trackeados.join(SEPARADOR)
    const verbo = trackeados.length === 1 ? 'modificado' : 'modificados'
    filas.push({
      estado: ESTADO.FRENA,
      detalle: `${lista} ${verbo} sin commitear`,
      remedio: `commiteá o descartá ${lista}: lo que se prueba es lo que se sube`,
    })
  }
  if (sinAgregar.length > 0) {
    filas.push({
      estado: ESTADO.AVISA,
      detalle: `${sinAgregar.join(SEPARADOR)} sin agregar`,
      remedio: REMEDIO_SIN_AGREGAR,
    })
  }
  return filas.length > 0 ? filas : [{ estado: ESTADO.PASA, detalle: 'sin cambios sin commitear' }]
}

function revisarNombre() {
  if (!configuracion().tasks)
    return { estado: ESTADO.SALTADO, detalle: 'saltado: el repo no usa tasks' }
  const rama = ramaActual()
  const task = taskDeLaRama(rama)
  if (task) return { estado: ESTADO.PASA, detalle: task }
  return { estado: ESTADO.AVISA, detalle: `«${rama}» sin número de task`, remedio: REMEDIO_RAMA }
}

function revisarAtraso() {
  if (!hayBase()) return sinBase(base())
  const atras = Number(git('rev-list', '--count', `HEAD..${base()}`).trim())
  if (atras === 0) return { estado: ESTADO.PASA, detalle: `al día con ${base()}` }
  return {
    estado: ESTADO.AVISA,
    detalle: `${plural(atras, 'commit')} atrás de ${base()}`,
    remedio: `git rebase ${base()} antes del PR`,
  }
}

export const limpio = Object.freeze({ nombre: 'limpio', correr: revisarLimpio })
export const nombreDeLaRama = Object.freeze({
  nombre: 'rama',
  guia: GUIAS.MENSAJE,
  correr: revisarNombre,
})
export const atraso = Object.freeze({ nombre: 'atraso', correr: revisarAtraso })
