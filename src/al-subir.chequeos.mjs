import { check } from './check.mjs'
import { coberturaAlSubir } from './cobertura.mjs'
import { commitsDesde, desdeDondeSalio, ramaActual } from './git.mjs'
import { chequeosDeLosCommits } from './mensaje.mjs'
import { atraso, limpio, nombreDeLaRama } from './rama.mjs'
import { variablesAlSubir } from './variables-entorno.mjs'
import { versionAlSubir } from './version.mjs'

function mensajesDeLaRama() {
  const desde = desdeDondeSalio()
  return desde === null ? null : commitsDesde(desde)
}

export function chequeosAlSubir() {
  return [
    limpio,
    ...chequeosDeLosCommits({ mensajes: mensajesDeLaRama, rama: ramaActual() }),
    variablesAlSubir,
    versionAlSubir,
    nombreDeLaRama,
    atraso,
    check,
    coberturaAlSubir,
  ]
}
