import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { nombreDeLaBase } from './config.mjs'
import { base, enRevision, git, hayBase, lineas } from './git.mjs'
import { ESTADO, sinBase } from './salida.mjs'

const CONFIGURACION = 'hooks'
const EXIGE_VERSION = 'exigeVersion'
const MANIFIESTO = 'package.json'
const LOCK = 'package-lock.json'
const SEMVER = /^(\d+)\.(\d+)\.(\d+)/
const FRENAN_EL_COMMIT = new Set([ESTADO.FRENA, ESTADO.ERROR])
const EL_COMMIT_NO_SALE = Object.freeze({
  estado: ESTADO.SALTADO,
  detalle: 'no se sube: el commit no sale',
})

const REMEDIO_SIN_STAGEAR = `stageá o descartá ${MANIFIESTO} y repetí el commit`
const REMEDIO_SUBIRLA = `npm version patch --no-git-tag-version y commiteá ${MANIFIESTO} con el lock`

function ramaBase() {
  return base()
}

function partes(numero) {
  const coincide = SEMVER.exec(numero ?? '')
  if (!coincide) throw new Error(`versión ilegible: ${numero}`)
  return coincide.slice(1).map(Number)
}

function esMayor(una, otra) {
  const a = partes(una)
  const b = partes(otra)
  const distinta = a.findIndex((parte, indice) => parte !== b[indice])
  return distinta !== -1 && a[distinta] > b[distinta]
}

function siguientePatch(base) {
  const [mayor, menor, patch] = partes(base)
  return `${mayor}.${menor}.${patch + 1}`
}

export function decidirVersion({ exige, propia, base }) {
  if (!exige) return { estado: ESTADO.SALTADO, detalle: 'saltado: el repo no la exige' }
  if (base === null) return sinBase(ramaBase())
  if (esMayor(propia, base))
    return { estado: ESTADO.PASA, detalle: `${propia} > ${nombreDeLaBase(ramaBase())} ${base}` }
  return { estado: ESTADO.SUBIDA, siguiente: siguientePatch(base) }
}

function manifiestoDe(revision) {
  return JSON.parse(git('show', `${revision}:${MANIFIESTO}`))
}

function versionDeLaBase() {
  return hayBase() ? manifiestoDe(ramaBase()).version : null
}

function exigeVersion(manifiesto) {
  return manifiesto[CONFIGURACION]?.[EXIGE_VERSION] === true
}

function subir(siguiente) {
  execFileSync('npm', ['version', siguiente, '--no-git-tag-version', '--ignore-scripts'], {
    stdio: 'pipe',
  })
  git('add', '--', ...[MANIFIESTO, LOCK].filter((archivo) => existsSync(archivo)))
}

function correr(previas = []) {
  if (previas.some(({ estado }) => FRENAN_EL_COMMIT.has(estado))) return EL_COMMIT_NO_SALE
  const propio = manifiestoDe('')
  const decision = decidirVersion({
    exige: exigeVersion(propio),
    propia: propio.version,
    base: versionDeLaBase(),
  })
  if (decision.estado !== ESTADO.SUBIDA) return decision
  const sinStagear = lineas(git('diff', '--name-only', '--', MANIFIESTO, LOCK))
  if (sinStagear.length > 0) {
    return {
      estado: ESTADO.AVISA,
      detalle: `${sinStagear.join(' · ')} con cambios sin stagear: no la subo`,
      remedio: REMEDIO_SIN_STAGEAR,
    }
  }
  subir(decision.siguiente)
  return {
    estado: ESTADO.SUBIDA,
    detalle: `${propio.version} → ${decision.siguiente}, subida en este commit`,
  }
}

function lockQueNoCoincide(propia) {
  const lock = enRevision('HEAD', LOCK)
  const delLock = lock === '' ? propia : JSON.parse(lock).version
  if (delLock === propia) return null
  return {
    estado: ESTADO.FRENA,
    detalle: `${LOCK} dice ${delLock} y ${MANIFIESTO} ${propia}`,
    remedio: REMEDIO_SUBIRLA,
  }
}

function correrAlSubir() {
  const propio = manifiestoDe('HEAD')
  const base = versionDeLaBase()
  const decision = decidirVersion({ exige: exigeVersion(propio), propia: propio.version, base })
  if (decision.estado === ESTADO.SUBIDA) {
    return {
      estado: ESTADO.FRENA,
      detalle: `${propio.version} no es mayor que ${nombreDeLaBase(ramaBase())} ${base}`,
      remedio: REMEDIO_SUBIRLA,
    }
  }
  if (decision.estado !== ESTADO.PASA) return decision
  return lockQueNoCoincide(propio.version) ?? decision
}

export const version = Object.freeze({ nombre: 'versión', clave: 'version', correr })
export const versionAlSubir = Object.freeze({
  nombre: 'versión',
  clave: 'version',
  correr: correrAlSubir,
})
