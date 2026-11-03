import { existsSync, readFileSync } from 'node:fs'

const MANIFIESTO = 'package.json'
const CLAVE = 'hooks'

export const POR_DEFECTO = Object.freeze({
  ramaBase: 'origin/main',
  exigeVersion: false,
  tasks: true,
  guiaUrl: null,
  apagados: Object.freeze([]),
  variables: Object.freeze({ esquema: 'start/env.ts', ejemplo: '.env.example', registro: null }),
  cobertura: Object.freeze({ incluye: 'src/**', nuevos: '^src/.+\\.(?:ts|js|mjs)$' }),
})

function leerManifiesto() {
  return existsSync(MANIFIESTO) ? JSON.parse(readFileSync(MANIFIESTO, 'utf8')) : {}
}

export function configuracion(manifiesto = leerManifiesto()) {
  const propia = manifiesto[CLAVE] ?? {}
  return Object.freeze({
    ...POR_DEFECTO,
    ...propia,
    variables: Object.freeze({ ...POR_DEFECTO.variables, ...(propia.variables ?? {}) }),
    cobertura: Object.freeze({ ...POR_DEFECTO.cobertura, ...(propia.cobertura ?? {}) }),
  })
}

export function nombreDeLaBase(ramaBase) {
  return ramaBase.split('/').slice(1).join('/') || ramaBase
}
