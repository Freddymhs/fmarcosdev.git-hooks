import { chequeosAlSubir } from './al-subir.chequeos.mjs'
import { ramaActual } from './git.mjs'
import { ejecutar } from './salida.mjs'

const [, , remoto] = process.argv

process.exitCode = await ejecutar({
  etapa: 'pre-push',
  contexto: () => [ramaActual(), remoto].filter(Boolean).join(' → '),
  chequeos: chequeosAlSubir,
})
