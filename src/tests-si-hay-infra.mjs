import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { parseEnv } from 'node:util'
import { AVISO_DE_TESTS, TESTS_SALTADOS, resumenDeTests, sinColor } from './check.mjs'
import { nuevaMedicion } from './cobertura.mjs'

const ARCHIVOS_DE_ENTORNO = Object.freeze(['.env', '.env.example'])
const REDIS_SI_NADIE_LO_DICE = Object.freeze({ host: 'localhost', port: 6379 })
const LO_QUE_PIDEN = Object.freeze([
  { dependencia: /^(?:@adonisjs\/redis|redis|ioredis)$/, necesita: 'Redis' },
  { dependencia: /^(?:@testcontainers\/.+|testcontainers)$/, necesita: 'Docker' },
])
const ESPERA_DE_REDIS_MS = 1000
const ESPERA_DE_DOCKER_MS = 5000
const FALLARON = 1
const SEPARADOR = ' · '
const LOS_TESTS = Object.freeze(['npm', 'test', '--silent'])
const MEDIDOR = 'c8'

export function necesidadesDe({ dependencies = {}, devDependencies = {} }) {
  const nombres = Object.keys({ ...dependencies, ...devDependencies })
  return LO_QUE_PIDEN.filter(({ dependencia }) =>
    nombres.some((nombre) => dependencia.test(nombre))
  ).map(({ necesita }) => necesita)
}

export function dondeEstaRedis({ entorno, leer }) {
  const archivos = ARCHIVOS_DE_ENTORNO.map((ruta) => leer(ruta))
    .filter((texto) => texto !== null)
    .map((texto) => parseEnv(texto))
  const valor = (clave) =>
    entorno[clave] ?? archivos.map((archivo) => archivo[clave]).find((uno) => uno !== undefined)
  return {
    host: valor('REDIS_HOST') ?? REDIS_SI_NADIE_LO_DICE.host,
    port: Number(valor('REDIS_PORT') ?? REDIS_SI_NADIE_LO_DICE.port),
  }
}

function leerSiExiste(ruta) {
  return existsSync(ruta) ? readFileSync(ruta, 'utf8') : null
}

function escucha({ host, port }) {
  return new Promise((resolver) => {
    const conexion = connect({ host, port, timeout: ESPERA_DE_REDIS_MS })
    const terminar = (respuesta) => {
      conexion.destroy()
      resolver(respuesta)
    }
    conexion.once('connect', () => terminar(true))
    conexion.once('timeout', () => terminar(false))
    conexion.once('error', () => terminar(false))
  })
}

function dockerResponde() {
  const { status } = spawnSync('docker', ['info'], {
    stdio: 'ignore',
    timeout: ESPERA_DE_DOCKER_MS,
  })
  return status === 0
}

async function faltante(necesita) {
  if (necesita === 'Docker') return dockerResponde() ? null : 'sin Docker'
  const redis = dondeEstaRedis({ entorno: process.env, leer: leerSiExiste })
  return (await escucha(redis)) ? null : `sin Redis en ${redis.host}:${redis.port}`
}

function correrLosTests([programa, ...argumentos]) {
  return new Promise((resolver, rechazar) => {
    const proceso = spawn(programa, argumentos, { stdio: ['ignore', 'pipe', 'pipe'] })
    const salida = []
    proceso.stdout.on('data', (trozo) => {
      salida.push(trozo)
      process.stdout.write(trozo)
    })
    proceso.stderr.on('data', (trozo) => {
      salida.push(trozo)
      process.stderr.write(trozo)
    })
    proceso.once('error', rechazar)
    proceso.once('close', (codigo) =>
      resolver({ codigo, salida: sinColor(Buffer.concat(salida).toString('utf8')) })
    )
  })
}

function tieneElMedidor({ dependencies = {}, devDependencies = {} }) {
  return Object.hasOwn({ ...dependencies, ...devDependencies }, MEDIDOR)
}

async function revisar() {
  const manifiesto = JSON.parse(readFileSync('package.json', 'utf8'))
  const medicion = nuevaMedicion()
  const faltan = []
  for (const necesita of necesidadesDe(manifiesto)) {
    const falta = await faltante(necesita)
    if (falta) faltan.push(falta)
  }
  if (faltan.length > 0) {
    const saltados = `${TESTS_SALTADOS}: ${faltan.join(SEPARADOR)}`
    medicion.noSePudo(`tests ${saltados}`)
    console.log(`${AVISO_DE_TESTS} ${saltados}`)
    return
  }
  const conMedidor = tieneElMedidor(manifiesto)
  if (!conMedidor) medicion.noSePudo(`el repo no tiene ${MEDIDOR}`)
  const { codigo, salida } = await correrLosTests(
    conMedidor ? medicion.envolver(LOS_TESTS) : LOS_TESTS
  )
  if (resumenDeTests(salida) === null) {
    const sinResumen = `sin resumen: npm test salió ${codigo} sin imprimir su resultado`
    medicion.noSePudo(`tests ${sinResumen}`)
    console.log(`${AVISO_DE_TESTS} ${sinResumen}`)
    return
  }
  if (conMedidor) medicion.medida()
  if (codigo !== 0) process.exitCode = FALLARON
}

if (process.argv[1] === import.meta.filename) await revisar()
