import { coberturaAlCommitear } from './cobertura.mjs'
import { git, lineas } from './git.mjs'
import { ejecutar, plural } from './salida.mjs'
import { secretos } from './secretos.mjs'
import { sonar } from './sonar.mjs'
import { variables } from './variables-entorno.mjs'
import { version } from './version.mjs'

const CHEQUEOS = [sonar, secretos, variables, coberturaAlCommitear, version]

function archivosStaged() {
  const cantidad = lineas(git('diff', '--cached', '--name-only')).length
  return `${plural(cantidad, 'archivo')} staged`
}

process.exitCode = await ejecutar({
  etapa: 'pre-commit',
  contexto: archivosStaged,
  chequeos: () => CHEQUEOS,
})
