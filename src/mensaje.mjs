import { base } from './git.mjs'
import { ESTADO, GUIAS, plural, sinBase } from './salida.mjs'

const TIPOS = Object.freeze([
  'feat',
  'fix',
  'refactor',
  'test',
  'docs',
  'chore',
  'perf',
  'style',
  'build',
  'ci',
])
const CON_TIPO = new RegExp(String.raw`^(${TIPOS.join('|')})(?:\([^)]*\))?!?: `)
const WIP = /^wip\b/i
const EXENTOS = /^(?:Merged PR |Merge |Revert |fixup! |squash! )/
const RAMA_CON_TASK = /^(?:feature|fix|hotfix|chore)\/(\d+)[_-]/
const NUMERAL = /(?<![&/\p{L}\p{N}])#(\d+)/gu
const TIJERA = /^# -+ >8 -+$/m
// core.commentChar no se lee: el hook asume el # por defecto de git; «#27006 x» no es comentario, git -m lo guarda
const COMENTARIO = /^#(?: |$)/
const LARGO_MAXIMO = 100
const AJENO_SIN_TASK_EN_LA_RAMA = ESTADO.AVISA

const SIN_TASK_EN_LA_RAMA = 'la rama no tiene número de task'
const EXENTO = Object.freeze({
  estado: ESTADO.SALTADO,
  detalle: 'exento: lo escribe git o el tracker',
})
const REMEDIO_WIP = 'vale mientras trabajás: squasheá antes del PR'
const REMEDIO_TIPO = TIPOS.join(' · ')
const REMEDIO_LARGO = 'acortá el asunto; el detalle va en el cuerpo'
const remedioCommits = () => `antes del PR, git rebase -i ${base()} y un commit con tipo y #task`
const sinCommitsPropios = () => ({
  estado: ESTADO.SALTADO,
  detalle: `saltado: 0 commits propios sobre ${base()}`,
})

function ejemploConTask(propio) {
  return `ejemplo: fix(${propio}): arreglo del filtro de fechas`
}

export function taskDeLaRama(rama) {
  return RAMA_CON_TASK.exec(rama ?? '')?.[1] ?? null
}

function textoDelMensaje(mensaje) {
  const [antesDeLaTijera] = mensaje.split(TIJERA)
  return antesDeLaTijera
    .split('\n')
    .filter((linea) => !COMENTARIO.test(linea))
    .join('\n')
}

export function asuntoDe(mensaje) {
  const lineas = textoDelMensaje(mensaje).split('\n')
  return lineas.map((linea) => linea.trim()).find((linea) => linea !== '') ?? ''
}

function numerosDe(texto) {
  return [...new Set([...texto.matchAll(NUMERAL)].map(([, numero]) => numero))]
}

function revisarAjenos(texto, task) {
  const numeros = numerosDe(texto)
  const ajenos = numeros.filter((numero) => numero !== task)
  if (ajenos.length === 0) return { estado: ESTADO.PASA, detalle: 'ningún # de otra task' }
  const lista = ajenos.map((numero) => `#${numero}`).join(' · ')
  const remedio = `sin #: otra task «HU ${ajenos[0]}» o un PR «PR ${ajenos[0]}»`
  if (task === null)
    return {
      estado: AJENO_SIN_TASK_EN_LA_RAMA,
      detalle: `${lista} y ${SIN_TASK_EN_LA_RAMA}`,
      remedio,
    }
  const verbo = ajenos.length === 1 ? 'no es' : 'no son'
  return {
    estado: ESTADO.FRENA,
    detalle: `${lista} ${verbo} la task de la rama (${task})`,
    remedio,
  }
}

function revisarTipo(asunto) {
  if (WIP.test(asunto))
    return { estado: ESTADO.AVISA, detalle: `«${asunto}»`, remedio: REMEDIO_WIP }
  const tipo = CON_TIPO.exec(asunto)?.[1]
  if (tipo) return { estado: ESTADO.PASA, detalle: tipo }
  return { estado: ESTADO.AVISA, detalle: `«${asunto}»`, remedio: REMEDIO_TIPO }
}

function revisarTask(texto, task) {
  if (task === null) return { estado: ESTADO.SALTADO, detalle: SIN_TASK_EN_LA_RAMA }
  const propio = `#${task}`
  if (numerosDe(texto).includes(task)) return { estado: ESTADO.PASA, detalle: propio }
  return {
    estado: ESTADO.AVISA,
    detalle: `sin ${propio}`,
    remedio: ejemploConTask(propio),
  }
}

function revisarLargo(asunto) {
  const largo = [...asunto].length
  if (largo <= LARGO_MAXIMO) return { estado: ESTADO.PASA, detalle: `${largo} caracteres` }
  return {
    estado: ESTADO.AVISA,
    detalle: `${largo} caracteres, máximo ${LARGO_MAXIMO}`,
    remedio: REMEDIO_LARGO,
  }
}

export function chequeosDelMensaje({ mensaje, rama }) {
  const texto = textoDelMensaje(mensaje)
  const asunto = asuntoDe(mensaje)
  const task = taskDeLaRama(rama)
  const exento = EXENTOS.test(asunto)
  const chequeo = (nombre, clave, correr) => ({
    nombre,
    clave,
    guia: GUIAS.MENSAJE,
    correr: exento ? () => EXENTO : correr,
  })
  return [
    chequeo('#ajeno', 'ajeno', () => revisarAjenos(texto, task)),
    chequeo('tipo', 'tipo', () => revisarTipo(asunto)),
    chequeo('#task', 'task', () => revisarTask(texto, task)),
    chequeo('largo', 'largo', () => revisarLargo(asunto)),
  ]
}

function propiosDe(mensajes) {
  return mensajes.filter((mensaje) => !EXENTOS.test(asuntoDe(mensaje)))
}

function revisarCommits(mensajes) {
  if (mensajes === null) return sinBase(base())
  const propios = propiosDe(mensajes)
  if (propios.length === 0) return sinCommitsPropios()
  const sinTipo = propios.filter((mensaje) => !CON_TIPO.test(asuntoDe(mensaje))).length
  if (sinTipo === 0)
    return { estado: ESTADO.PASA, detalle: `${plural(propios.length, 'commit')} con tipo` }
  return {
    estado: ESTADO.AVISA,
    detalle: `${sinTipo} de ${propios.length} wip o sin tipo`,
    remedio: remedioCommits(),
  }
}

function revisarTaskDeLosCommits(mensajes, task) {
  if (task === null) return { estado: ESTADO.SALTADO, detalle: SIN_TASK_EN_LA_RAMA }
  if (mensajes === null) return sinBase(base())
  const propios = propiosDe(mensajes)
  if (propios.length === 0) return sinCommitsPropios()
  const propio = `#${task}`
  const sinTask = propios.filter(
    (mensaje) => !numerosDe(textoDelMensaje(mensaje)).includes(task)
  ).length
  if (sinTask === 0)
    return { estado: ESTADO.PASA, detalle: `${propio} en ${plural(propios.length, 'commit')}` }
  return {
    estado: ESTADO.AVISA,
    detalle: `${sinTask} de ${propios.length} sin ${propio}`,
    remedio: ejemploConTask(propio),
  }
}

export function chequeosDeLosCommits({ mensajes, rama }) {
  const task = taskDeLaRama(rama)
  return [
    { nombre: 'commits', guia: GUIAS.MENSAJE, correr: () => revisarCommits(mensajes()) },
    {
      nombre: '#task',
      clave: 'task',
      guia: GUIAS.MENSAJE,
      correr: () => revisarTaskDeLosCommits(mensajes(), task),
    },
  ]
}
