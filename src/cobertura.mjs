import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  archivosDelIndiceQueCalzan,
  base,
  desdeDondeSalio,
  diffDeLaRama,
  git,
  lineas,
  lineasAgregadas,
} from './git.mjs'
import { configuracion } from './config.mjs'
import { ESTADO, GUIAS, plural, rangos, sinBase } from './salida.mjs'

const CARPETA = 'hooks-cobertura'
const REPORTE = 'coverage-final.json'
const ARCHIVO_DEL_HEAD = 'head'
const ARCHIVO_DEL_MOTIVO = 'motivo'
const SOLO_TIPOS = /\.(?:dto|d)\.ts$/
const SPECS = [':(glob)tests/**/*.spec.*']
const EXTENSION_TS = /\.ts$/
const DESTINO_DE_ALIAS = /^\.\/(.+)\/\*\.js$/
const COMODIN = '*'
const CARACTERES_DE_REGEX = /[.*+?^${}()|[\]\\]/g
const NUEVOS = 'A'
const AGREGADOS_O_MODIFICADOS = 'AM'

const sinNuevos = (patron) => ({
  estado: ESTADO.SALTADO,
  detalle: `saltado: ningún archivo nuevo que calce con ${patron}`,
})
const REMEDIO_SIN_SPEC =
  'sumale un spec en tests/ que lo importe: al pushear frenan sus líneas sin cubrir'
const REMEDIO_SIN_CUBRIR =
  'sumá un test que pase por esas líneas; en local: npm run test:si-hay-infra'
const REMEDIO_SIN_MEDIR = 'levantá lo que piden los tests y repetí el push'

function codigoConTipos(ruta) {
  return !SOLO_TIPOS.test(ruta)
}

function carpetaDeLaMedicion() {
  return resolve(git('rev-parse', '--git-path', CARPETA).trim())
}

export function nuevaMedicion() {
  const carpeta = carpetaDeLaMedicion()
  rmSync(carpeta, { recursive: true, force: true })
  mkdirSync(carpeta, { recursive: true })
  return Object.freeze({
    envolver: (comando) => [
      'npx',
      '--no-install',
      'c8',
      '--reporter=json',
      `--report-dir=${carpeta}`,
      `--temp-directory=${join(carpeta, 'tmp')}`,
      '--all',
      `--include=${configuracion().cobertura.incluye}`,
      ...comando,
    ],
    noSePudo: (motivo) => writeFileSync(join(carpeta, ARCHIVO_DEL_MOTIVO), motivo),
    medida: () => writeFileSync(join(carpeta, ARCHIVO_DEL_HEAD), git('rev-parse', 'HEAD').trim()),
  })
}

function leerSiExiste(ruta) {
  return existsSync(ruta) ? readFileSync(ruta, 'utf8').trim() : null
}

function medicionDeEsteHead() {
  const carpeta = carpetaDeLaMedicion()
  const motivo = leerSiExiste(join(carpeta, ARCHIVO_DEL_MOTIVO))
  if (motivo) return { motivo }
  const head = leerSiExiste(join(carpeta, ARCHIVO_DEL_HEAD))
  if (head !== git('rev-parse', 'HEAD').trim())
    return { motivo: 'no hay una medición de este commit' }
  return { reporte: JSON.parse(readFileSync(join(carpeta, REPORTE), 'utf8')) }
}

function vecesPorLinea({ statementMap, s }) {
  const veces = new Map()
  for (const [id, { start }] of Object.entries(statementMap)) {
    veces.set(start.line, Math.max(veces.get(start.line) ?? 0, s[id]))
  }
  return veces
}

function filaSinCubrir(ruta, numeros) {
  return {
    estado: ESTADO.FRENA,
    detalle: `${ruta}:${rangos(numeros)}  ${plural(numeros.length, 'línea nueva sin cubrir', 'líneas nuevas sin cubrir')}`,
    remedio: REMEDIO_SIN_CUBRIR,
  }
}

export function filasDeCobertura({ agregadas, reporte, raiz }) {
  const porRuta = new Map()
  for (const { ruta, numero, texto } of agregadas) {
    if (!codigoConTipos(ruta) || texto.trim() === '') continue
    const archivo = reporte[resolve(raiz, ruta)]
    const veces = archivo ? vecesPorLinea(archivo).get(numero) : undefined
    if (veces === undefined) continue
    porRuta.set(ruta, [...(porRuta.get(ruta) ?? []), { numero, veces }])
  }
  const medidas = [...porRuta.values()].flat()
  const sinCubrir = [...porRuta].flatMap(([ruta, lineasDeLaRuta]) => {
    const numeros = lineasDeLaRuta.filter(({ veces }) => veces === 0).map(({ numero }) => numero)
    return numeros.length > 0 ? [filaSinCubrir(ruta, numeros)] : []
  })
  if (sinCubrir.length > 0) return sinCubrir
  if (medidas.length === 0)
    return [
      {
        estado: ESTADO.PASA,
        detalle: `0 líneas nuevas en ${configuracion().cobertura.incluye} para cubrir`,
      },
    ]
  return [
    {
      estado: ESTADO.PASA,
      detalle: `${plural(medidas.length, 'línea nueva', 'líneas nuevas')}, todas cubiertas`,
    },
  ]
}

function revisarAlSubir() {
  const desde = desdeDondeSalio()
  if (desde === null) return sinBase(base())
  const { motivo, reporte } = medicionDeEsteHead()
  if (motivo)
    return {
      estado: ESTADO.AVISA,
      detalle: `no se pudo medir: ${motivo}`,
      remedio: REMEDIO_SIN_MEDIR,
    }
  const agregadas = lineasAgregadas(diffDeLaRama(desde, AGREGADOS_O_MODIFICADOS))
  return filasDeCobertura({ agregadas, reporte, raiz: process.cwd() })
}

function escapar(texto) {
  return texto.replaceAll(CARACTERES_DE_REGEX, String.raw`\$&`)
}

function nombresDelModulo(ruta, alias) {
  const sinExtension = ruta.replace(EXTENSION_TS, '')
  const porAlias = Object.entries(alias).flatMap(([nombre, destino]) => {
    const carpeta = DESTINO_DE_ALIAS.exec(destino)?.[1]
    if (!carpeta || !sinExtension.startsWith(`${carpeta}/`)) return []
    return [nombre.replace(COMODIN, sinExtension.slice(carpeta.length + 1))]
  })
  return [sinExtension, ...porAlias]
}

function tieneSpec(ruta, alias) {
  const nombres = nombresDelModulo(ruta, alias)
    .map((nombre) => escapar(nombre))
    .join('|')
  return archivosDelIndiceQueCalzan(`(${nombres})(\\.js|\\.ts)?['"]`, SPECS).length > 0
}

function revisarAlCommitear() {
  const patron = configuracion().cobertura.nuevos
  const aCubrir = new RegExp(patron)
  const nuevos = lineas(
    git('diff', '--cached', '--name-only', '--no-renames', `--diff-filter=${NUEVOS}`)
  )
    .filter((ruta) => aCubrir.test(ruta))
    .filter((ruta) => codigoConTipos(ruta))
  if (nuevos.length === 0) return sinNuevos(patron)
  const { imports: alias = {} } = JSON.parse(readFileSync('package.json', 'utf8'))
  const sinSpec = nuevos.filter((ruta) => !tieneSpec(ruta, alias))
  if (sinSpec.length === 0) {
    return {
      estado: ESTADO.PASA,
      detalle: plural(nuevos.length, 'archivo nuevo con su spec', 'archivos nuevos con su spec'),
    }
  }
  return sinSpec.map((ruta) => ({
    estado: ESTADO.AVISA,
    detalle: `${ruta}  nuevo, sin un spec que lo importe`,
    remedio: REMEDIO_SIN_SPEC,
  }))
}

export const coberturaAlCommitear = Object.freeze({
  nombre: 'cobertura',
  guia: GUIAS.COBERTURA,
  saltable: false,
  correr: revisarAlCommitear,
})
export const coberturaAlSubir = Object.freeze({
  nombre: 'cobertura',
  guia: GUIAS.COBERTURA,
  saltable: false,
  correr: revisarAlSubir,
})
