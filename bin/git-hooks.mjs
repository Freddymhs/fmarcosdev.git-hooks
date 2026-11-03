#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const CARPETA_DE_HUSKY = '.husky'
const EJECUTABLE = 0o755
const USO_INCORRECTO = 2

const ETAPAS = Object.freeze({
  'commit-msg': 'mensaje-commit.mjs',
  'pre-commit': 'al-commitear.mjs',
  'pre-push': 'al-subir.mjs',
})

const USO = `uso:
  git-hooks init                 escribe .husky/commit-msg, pre-commit y pre-push
  git-hooks commit-msg <archivo> corre la etapa (lo llama el hook)
  git-hooks pre-commit
  git-hooks pre-push [remoto]

configuración: la clave "hooks" de package.json (ver README)
`

function escribirHook(etapa) {
  const ruta = join(CARPETA_DE_HUSKY, etapa)
  const existia = existsSync(ruta)
  writeFileSync(ruta, `npx --no-install git-hooks ${etapa} "$@"\n`)
  chmodSync(ruta, EJECUTABLE)
  return `${existia ? 'reescrito' : 'creado'}  ${ruta}`
}

function init() {
  mkdirSync(CARPETA_DE_HUSKY, { recursive: true })
  const lineas = Object.keys(ETAPAS).map((etapa) => escribirHook(etapa))
  process.stdout.write(`${lineas.join('\n')}

falta, si no está:
  npm i -D husky && npm pkg set scripts.prepare=husky && npm run prepare
  y la clave "hooks" en package.json (ramaBase, exigeVersion, tasks, guiaUrl, variables, cobertura)
`)
}

const [comando, ...resto] = process.argv.slice(2)

if (comando === 'init') {
  init()
} else if (Object.hasOwn(ETAPAS, comando)) {
  process.argv = [process.argv[0], process.argv[1], ...resto]
  await import(join(SRC, ETAPAS[comando]))
} else {
  process.stderr.write(USO)
  process.exitCode = USO_INCORRECTO
}
