import { readFileSync } from 'node:fs'
import { ramaActual } from './git.mjs'
import { chequeosDelMensaje } from './mensaje.mjs'
import { ejecutar } from './salida.mjs'

const archivoDelMensaje = process.argv.at(-1)
const mensaje = readFileSync(archivoDelMensaje, 'utf8')

process.exitCode = await ejecutar({
  etapa: 'commit-msg',
  chequeos: () => chequeosDelMensaje({ mensaje, rama: ramaActual() }),
})
