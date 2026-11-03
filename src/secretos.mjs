import { diffStaged, git, lineas, lineasAgregadas } from './git.mjs'
import { ESTADO, plural } from './salida.mjs'

const EN_LINEA_AGREGADA = 'en una línea agregada'

const CLAVE_GENERICA = /^key$/i
const NOMBRE_DE_VARIABLE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/

const FORMAS_DE_SECRETO = Object.freeze([
  { forma: /_(?:password|authToken)=/, nombrar: ([texto]) => `${texto} ${EN_LINEA_AGREGADA}` },
  { forma: /-----BEGIN [A-Z ]*PRIVATE KEY/, nombrar: ([texto]) => `${texto} ${EN_LINEA_AGREGADA}` },
  { forma: /sk-(?:ant|cp)-/, nombrar: ([texto]) => `${texto} ${EN_LINEA_AGREGADA}` },
  {
    forma: /(\w*(?:key|token|secret|password))['"]?\s*[=:]\s*['"]([^'"\s]{12,})/gi,
    nombrar: ([, clave]) => `${clave} con un valor literal`,
    descartar: ([, clave, valor]) => CLAVE_GENERICA.test(clave) || NOMBRE_DE_VARIABLE.test(valor),
  },
])

const ARCHIVO_SENSIBLE = /^(?:\.env(?:\..+)?|\.npmrc)$/
const ARCHIVO_DE_EJEMPLO = /\.example$/
const AGREGADOS_O_CAMBIADOS = 'ACMR'

const REMEDIO_EN_LINEA = 'sacá la llave del commit y rotala'
const REMEDIO_ARCHIVO = 'sacalo del commit: git restore --staged <archivo>'

function esSensible(ruta) {
  const nombre = ruta.split('/').at(-1)
  return ARCHIVO_SENSIBLE.test(nombre) && !ARCHIVO_DE_EJEMPLO.test(nombre)
}

function coincidenciasDe(forma, texto) {
  return forma.global ? [...texto.matchAll(forma)] : [forma.exec(texto)].filter(Boolean)
}

function secretoEn(texto) {
  for (const { forma, nombrar, descartar } of FORMAS_DE_SECRETO) {
    const coincidencia = coincidenciasDe(forma, texto).find((una) => !descartar?.(una))
    if (coincidencia) return nombrar(coincidencia)
  }
  return null
}

function hallazgoEnLinea({ ruta, numero, texto }) {
  const secreto = secretoEn(texto)
  if (secreto === null) return []
  return [
    { estado: ESTADO.FRENA, detalle: `${ruta}:${numero}  ${secreto}`, remedio: REMEDIO_EN_LINEA },
  ]
}

function hallazgoDeArchivo(ruta) {
  return {
    estado: ESTADO.FRENA,
    detalle: `${ruta}  archivo sensible staged`,
    remedio: REMEDIO_ARCHIVO,
  }
}

export function revisarSecretos({ rutas, diff }) {
  const agregadas = lineasAgregadas(diff)
  const hallazgos = [
    ...rutas.filter((ruta) => esSensible(ruta)).map((ruta) => hallazgoDeArchivo(ruta)),
    ...agregadas.flatMap((linea) => hallazgoEnLinea(linea)),
  ]
  if (hallazgos.length > 0) return hallazgos
  const revisadas = plural(agregadas.length, 'línea agregada', 'líneas agregadas')
  return [{ estado: ESTADO.PASA, detalle: `0 en ${revisadas}` }]
}

function staged() {
  return {
    rutas: lineas(git('diff', '--cached', '--name-only', `--diff-filter=${AGREGADOS_O_CAMBIADOS}`)),
    diff: diffStaged(AGREGADOS_O_CAMBIADOS),
  }
}

export const secretos = Object.freeze({
  nombre: 'secretos',
  saltable: false,
  correr: () => revisarSecretos(staged()),
})
