import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { configuracion } from './config.mjs'

export function base() {
  return configuracion().ramaBase
}
const FIN_DE_COMMIT = '\u001E'
const MEGABYTE = 1024 * 1024
const GREP_SIN_RESULTADOS = 1
const MAX_BUFFER = 256 * MEGABYTE
const RAMA_EN_REBASE = ['rebase-merge/head-name', 'rebase-apply/head-name']
const PREFIJO_DE_RAMA = /^refs\/heads\//
const INICIO_DE_ARCHIVO = /^diff --git /m
const INICIO_DE_HUNK = /^(?=@@ )/m
// git cierra con un TAB la ruta que tiene espacios en las líneas --- y +++
const AGREGADAS = Object.freeze({
  signo: '+',
  ruta: /^\+\+\+ b\/(.+?)\t?$/m,
  primera: /^@@ -\S+ \+(\d+)/,
})
const BORRADAS = Object.freeze({ signo: '-', ruta: /^--- a\/(.+?)\t?$/m, primera: /^@@ -(\d+)/ })

export function git(...args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export function diffStaged(filtro) {
  return git(
    'diff',
    '--cached',
    '-U0',
    '--no-renames',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    `--diff-filter=${filtro}`
  )
}

export function hayBase() {
  return git('for-each-ref', '--format=%(refname)', `refs/remotes/${base()}`).trim() !== ''
}

export function desdeDondeSalio() {
  return hayBase() ? git('merge-base', base(), 'HEAD').trim() : null
}

export function enRevision(revision, ruta) {
  const existe = git('ls-tree', '--name-only', revision, '--', ruta).trim() !== ''
  return existe ? git('show', `${revision}:${ruta}`) : ''
}

export function diffEntre(desde, hasta, filtro) {
  return git(
    'diff',
    '-U0',
    '--no-renames',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    `--diff-filter=${filtro}`,
    desde,
    hasta
  )
}

export function diffDeLaRama(desde, filtro) {
  return diffEntre(desde, 'HEAD', filtro)
}

export function otraRamaDelMerge() {
  const archivo = git('rev-parse', '--git-path', 'MERGE_HEAD').trim()
  if (!existsSync(archivo)) return null
  const [otra] = lineas(readFileSync(archivo, 'utf8'))
  return { otra, desde: git('merge-base', 'HEAD', otra).trim() }
}

export function commitsDesde(desde) {
  return git('log', `--format=%B${FIN_DE_COMMIT}`, `${desde}..HEAD`)
    .split(FIN_DE_COMMIT)
    .map((mensaje) => mensaje.trim())
    .filter((mensaje) => mensaje !== '')
}

export function archivosDelIndiceQueCalzan(patron, rutas) {
  const { status, stdout, stderr } = spawnSync(
    'git',
    ['-c', 'core.quotePath=false', 'grep', '--cached', '-l', '-E', patron, '--', ...rutas],
    { encoding: 'utf8', maxBuffer: MAX_BUFFER }
  )
  if (status === GREP_SIN_RESULTADOS) return []
  if (status !== 0) throw new Error(`git grep falló: ${stderr.trim()}`)
  return lineas(stdout)
}

export function lineas(texto) {
  return texto.split('\n').filter((linea) => linea !== '')
}

export function ramaActual() {
  const rutas = RAMA_EN_REBASE.map((archivo) => git('rev-parse', '--git-path', archivo).trim())
  const enRebase = rutas.find((ruta) => existsSync(ruta))
  if (enRebase) return readFileSync(enRebase, 'utf8').trim().replace(PREFIJO_DE_RAMA, '')
  try {
    return git('symbolic-ref', '--short', '-q', 'HEAD').trim()
  } catch {
    return git('rev-parse', '--abbrev-ref', 'HEAD').trim()
  }
}

function lineasDelHunk(ruta, hunk, { signo, primera }) {
  const [cabecera, ...cuerpo] = hunk.split('\n')
  const desde = Number(primera.exec(cabecera)[1])
  return cuerpo
    .filter((linea) => linea.startsWith(signo))
    .map((linea, indice) => ({ ruta, numero: desde + indice, texto: linea.slice(signo.length) }))
}

function lineasDelArchivo(bloque, lado) {
  const [encabezado, ...hunks] = bloque.split(INICIO_DE_HUNK)
  const ruta = lado.ruta.exec(encabezado)?.[1]
  if (!ruta) return []
  return hunks.flatMap((hunk) => lineasDelHunk(ruta, hunk, lado))
}

function lineasDelDiff(diff, lado) {
  return diff.split(INICIO_DE_ARCHIVO).flatMap((bloque) => lineasDelArchivo(bloque, lado))
}

export function lineasAgregadas(diff) {
  return lineasDelDiff(diff, AGREGADAS)
}

export function lineasBorradas(diff) {
  return lineasDelDiff(diff, BORRADAS)
}
