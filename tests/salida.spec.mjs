import { test } from './japa.mjs'
import {
  ESTADO,
  GUIAS,
  SALIDA,
  colorPorDefecto,
  ejecutar,
  nombreCorto,
  rangos,
} from '../src/salida.mjs'

const GUIA_URL = 'https://guia.ejemplo/hooks'

const ESC = String.fromCodePoint(27)

function chequeo(nombre, resultado, extra = {}) {
  return { nombre, correr: () => resultado, ...extra }
}

async function correrCon(chequeos, opciones = {}) {
  const escrito = []
  const codigo = await ejecutar({
    url: GUIA_URL,
    etapa: 'pre-commit',
    repo: 'api.bff',
    chequeos: () => chequeos,
    entorno: {},
    color: false,
    escribir: (texto) => escrito.push(texto),
    ...opciones,
  })
  const texto = escrito.join('')
  return { codigo, texto, lineas: texto.split('\n') }
}

test.group('hooks · salida', () => {
  test('limpio: sale 0 con el veredicto y sin bloque de remedios', async ({ assert }) => {
    const { codigo, texto, lineas } = await correrCon(
      [chequeo('secretos', { estado: ESTADO.PASA, detalle: '0 en 38 líneas agregadas' })],
      { contexto: () => '2 archivos staged' }
    )
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.equal(lineas[0], 'husky · pre-commit · api.bff · 2 archivos staged')
    assert.include(lineas, '✔ secretos     0 en 38 líneas agregadas')
    assert.match(texto, /^✔ \d+\.\d s$/m)
    assert.notInclude(texto, 'índice')
  })

  test('frena: sale 1, cuenta el problema y da el remedio con su guía y las URL una vez', async ({
    assert,
  }) => {
    const { codigo, texto, lineas } = await correrCon([
      chequeo('secretos', {
        estado: ESTADO.FRENA,
        detalle: 'config/mail.ts:12  token en una línea agregada',
        remedio: 'sacá la llave del commit y rotala',
      }),
      chequeo(
        'variables',
        {
          estado: ESTADO.AVISA,
          detalle: 'start/env.ts:41  MAIL_DEBUG no está en Consul',
          remedio: 'si es solo local, está bien; si va a dev, agregala',
        },
        { guia: GUIAS.VARIABLES }
      ),
    ])
    assert.equal(codigo, SALIDA.ENCONTRO)
    assert.include(lineas, '✖ secretos     config/mail.ts:12  token en una línea agregada')
    assert.match(texto, /^✖ 1 problema · ⚠ 1 aviso · \d+\.\d s$/m)
    const secretos = lineas.find((linea) => linea.startsWith('  secretos'))
    const variables = lineas.find((linea) => linea.startsWith('  variables'))
    assert.match(secretos, /^ {2}secretos {3}sacá la llave del commit y rotala +índice$/)
    assert.match(variables, /^ {2}variables {2}si es solo local.* +guía: variables$/)
    assert.equal(secretos.indexOf('índice'), variables.indexOf('guía:'))
    assert.lengthOf(
      lineas.filter((linea) => linea === `  índice: ${GUIA_URL}`),
      1
    )
    assert.lengthOf(
      lineas.filter((linea) => linea === `  variables: ${GUIA_URL}/Variables%20de%20entorno`),
      1
    )
  })

  test('dos chequeos con la misma guía la nombran los dos y su URL sale una vez', async ({
    assert,
  }) => {
    const aviso = { estado: ESTADO.AVISA, detalle: 'x', remedio: 'y' }
    const { lineas } = await correrCon([
      chequeo('tipo', aviso, { guia: GUIAS.MENSAJE }),
      chequeo('#task', aviso, { guia: GUIAS.MENSAJE }),
    ])
    assert.lengthOf(
      lineas.filter((linea) => linea.endsWith('guía: mensaje')),
      2
    )
    assert.lengthOf(
      lineas.filter((linea) => linea.startsWith('  mensaje: ')),
      1
    )
    assert.include(lineas, `  mensaje: ${GUIA_URL}/Mensaje%20y%20rama`)
    assert.isUndefined(lineas.find((linea) => linea.startsWith('  índice: ')))
  })

  test('solo avisos: sale 0 y el veredicto empieza con ✔', async ({ assert }) => {
    const { codigo, texto } = await correrCon([
      chequeo('tipo', { estado: ESTADO.AVISA, detalle: '«wip cosas»', remedio: 'poné un tipo' }),
      chequeo('#task', { estado: ESTADO.AVISA, detalle: 'sin #27005', remedio: 'sumá el #' }),
    ])
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.match(texto, /^✔ ⚠ 2 avisos · \d+\.\d s$/m)
    assert.include(texto, `  índice: ${GUIA_URL}`)
  })

  test('versión subida: fila ⬆, sale 0 y no pide remedio', async ({ assert }) => {
    const { codigo, texto, lineas } = await correrCon([
      chequeo('versión', {
        estado: ESTADO.SUBIDA,
        detalle: '1.8.9 → 1.8.10, subida en este commit',
      }),
    ])
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.include(lineas, '⬆ versión      1.8.9 → 1.8.10, subida en este commit')
    assert.notInclude(texto, 'índice')
  })

  test('un ✖ sin remedio es un hook roto: sale 2, no 1', async ({ assert }) => {
    const { codigo, texto } = await correrCon([
      chequeo('secretos', { estado: ESTADO.FRENA, detalle: '.env staged' }),
    ])
    assert.equal(codigo, SALIDA.NO_PUDO)
    assert.match(texto, /^✖ secretos +no pudo correr: .*sin remedio/m)
  })

  test('un ⚠ sin remedio también es un hook roto', async ({ assert }) => {
    const { codigo } = await correrCon([
      chequeo('tipo', { estado: ESTADO.AVISA, detalle: '«wip»' }),
    ])
    assert.equal(codigo, SALIDA.NO_PUDO)
  })

  test('un – sin motivo es un hook roto: sale 2', async ({ assert }) => {
    const { codigo, texto } = await correrCon([chequeo('variables', { estado: ESTADO.SALTADO })])
    assert.equal(codigo, SALIDA.NO_PUDO)
    assert.match(texto, /^✖ variables +no pudo correr: .*sin motivo/m)
  })

  test('un chequeo que revienta sale 2, lo dice en su fila y da un remedio', async ({ assert }) => {
    const { codigo, texto, lineas } = await correrCon([
      chequeo('sonar', null, {
        correr: () => {
          throw new Error('Node 24 no corre node ace\nstack que no se muestra')
        },
        remedioSiNoCorre: 'volta run --node 22 y repetí el commit',
        guia: GUIAS.SONAR,
      }),
    ])
    assert.equal(codigo, SALIDA.NO_PUDO)
    assert.include(lineas, '✖ sonar        no pudo correr: Node 24 no corre node ace')
    assert.notInclude(texto, 'stack que no se muestra')
    assert.match(texto, /^✖ no pudo correr · exit 2$/m)
    assert.match(texto, /^ {2}sonar +volta run --node 22 y repetí el commit +guía: sonar$/m)
    assert.include(lineas, `  sonar: ${GUIA_URL}/Reglas%20de%20Sonar`)
  })

  test('si revienta el hook y no un chequeo, sale 2 y lo dice', async ({ assert }) => {
    const { codigo, texto } = await correrCon(
      [chequeo('secretos', { estado: ESTADO.PASA, detalle: '0' })],
      {
        contexto: () => {
          throw new Error('not a git repository')
        },
      }
    )
    assert.equal(codigo, SALIDA.NO_PUDO)
    assert.match(texto, /^✖ husky · pre-commit no pudo correr: not a git repository$/m)
  })

  test('si armar los chequeos revienta, sale 2 y lo dice', async ({ assert }) => {
    const escrito = []
    const codigo = await ejecutar({
      url: GUIA_URL,
      etapa: 'commit-msg',
      repo: 'api.bff',
      chequeos: () => {
        throw new Error('ENOENT: no such file .git/COMMIT_EDITMSG')
      },
      entorno: {},
      color: false,
      escribir: (texto) => escrito.push(texto),
    })
    assert.equal(codigo, SALIDA.NO_PUDO)
    assert.match(escrito.join(''), /^✖ husky · commit-msg no pudo correr: ENOENT/m)
  })

  test('un chequeo que no devuelve filas es un hook roto', async ({ assert }) => {
    const { codigo } = await correrCon([chequeo('secretos', [])])
    assert.equal(codigo, SALIDA.NO_PUDO)
  })

  test('corre todos los chequeos aunque uno frene', async ({ assert }) => {
    const corridos = []
    const registrar = (nombre, estado) =>
      chequeo(nombre, null, {
        correr: () => {
          corridos.push(nombre)
          return { estado, detalle: 'x', remedio: 'y' }
        },
      })
    await correrCon([registrar('secretos', ESTADO.FRENA), registrar('plantilla', ESTADO.PASA)])
    assert.deepEqual(corridos, ['secretos', 'plantilla'])
  })

  test('cada chequeo recibe las filas de los anteriores, con su nombre', async ({ assert }) => {
    const vistas = []
    await correrCon([
      chequeo('secretos', { estado: ESTADO.FRENA, detalle: 'x', remedio: 'y' }),
      {
        nombre: 'versión',
        correr: (previas) => {
          vistas.push(previas)
          return { estado: ESTADO.PASA, detalle: 'z' }
        },
      },
    ])
    assert.lengthOf(vistas, 1)
    assert.deepInclude(vistas[0][0], { nombre: 'secretos', estado: ESTADO.FRENA })
  })

  test('un chequeo puede devolver varias filas, y su remedio sale una sola vez', async ({
    assert,
  }) => {
    const { lineas } = await correrCon([
      chequeo('plantilla', [
        { estado: ESTADO.FRENA, detalle: 'a.ts:1  del SAG', remedio: 'revertí la línea' },
        { estado: ESTADO.FRENA, detalle: 'b.ts:2  del SAG', remedio: 'revertí la línea' },
      ]),
    ])
    assert.lengthOf(
      lineas.filter((linea) => linea.startsWith('✖ plantilla')),
      2
    )
    assert.lengthOf(
      lineas.filter((linea) => linea.startsWith('  plantilla ')),
      1
    )
    assert.include(lineas.join('\n'), '✖ 2 problemas')
  })

  test('un chequeo con hallazgos de distinto tipo da una línea por cada remedio', async ({
    assert,
  }) => {
    const { lineas } = await correrCon([
      chequeo('secretos', [
        {
          estado: ESTADO.FRENA,
          detalle: '.env  archivo sensible staged',
          remedio: 'sacalo del commit',
        },
        { estado: ESTADO.FRENA, detalle: 'a.ts:1  token', remedio: 'rotá la llave' },
        { estado: ESTADO.FRENA, detalle: 'b.ts:2  token', remedio: 'rotá la llave' },
      ]),
    ])
    const remedios = lineas.filter((linea) => linea.startsWith('  secretos '))
    assert.lengthOf(remedios, 2)
    assert.match(remedios[0], /sacalo del commit/)
    assert.match(remedios[1], /rotá la llave/)
  })

  test('hooks.apagados apaga el chequeo nombrado, sin correrlo, y la fila lo dice', async ({
    assert,
  }) => {
    const { codigo, lineas } = await correrCon(
      [
        chequeo('variables', null, {
          correr: () => {
            throw new Error('no debía correr')
          },
        }),
        chequeo('rama', null, {
          correr: () => {
            throw new Error('no debía correr')
          },
        }),
      ],
      { apagados: ['variables', 'rama'] }
    )
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.include(lineas, '– variables    apagado en package.json (hooks.apagados)')
    assert.include(lineas, '– rama         apagado en package.json (hooks.apagados)')
  })

  test('apagar en package.json vale también para lo que no se salta por entorno: es decisión del repo', async ({
    assert,
  }) => {
    const { codigo, lineas } = await correrCon(
      [
        chequeo(
          'secretos',
          { estado: ESTADO.FRENA, detalle: '.env staged', remedio: 'sacalo' },
          { saltable: false }
        ),
      ],
      { apagados: ['secretos'] }
    )
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.include(lineas, '– secretos     apagado en package.json (hooks.apagados)')
  })

  test('la variable de entorno SKIP ya no salta nada', async ({ assert }) => {
    const { codigo } = await correrCon(
      [chequeo('rama', { estado: ESTADO.FRENA, detalle: 'x', remedio: 'y' })],
      { entorno: { SKIP: 'rama' } }
    )
    assert.equal(codigo, SALIDA.ENCONTRO)
  })

  test('una fila solo-verbose aparece solo con HOOKS_VERBOSE=1', async ({ assert }) => {
    const filas = [
      { estado: ESTADO.PASA, detalle: '0 en 3 archivos' },
      { estado: ESTADO.PASA, detalle: 'app/a.ts  0 de 12 líneas', soloVerbose: true },
    ]
    const normal = await correrCon([chequeo('secretos', filas)])
    const detallado = await correrCon([chequeo('secretos', filas)], {
      entorno: { HOOKS_VERBOSE: '1' },
    })
    assert.notInclude(normal.texto, 'app/a.ts')
    assert.include(detallado.texto, 'app/a.ts')
  })

  test('sin color no hay secuencias de escape; con color, sí', async ({ assert }) => {
    const resultado = { estado: ESTADO.FRENA, detalle: 'x', remedio: 'y' }
    const plano = await correrCon([chequeo('secretos', resultado)])
    const coloreado = await correrCon([chequeo('secretos', resultado)], { color: true })
    assert.notInclude(plano.texto, ESC)
    assert.include(coloreado.texto, ESC)
  })

  test('el color se apaga con NO_COLOR o sin TTY', ({ assert }) => {
    assert.isTrue(colorPorDefecto({}, { isTTY: true }))
    assert.isFalse(colorPorDefecto({ NO_COLOR: '1' }, { isTTY: true }))
    assert.isFalse(colorPorDefecto({}, { isTTY: false }))
  })

  test('el nombre del repo son los dos últimos segmentos del paquete', ({ assert }) => {
    assert.equal(nombreCorto('sag.laboratorio.api.bff'), 'api.bff')
    assert.equal(nombreCorto('api.storage'), 'api.storage')
    assert.equal(nombreCorto('suelto'), 'suelto')
  })
  test('una guía que es un .md enlaza por ancla, no por subpágina', async ({ assert }) => {
    const { lineas } = await correrCon(
      [
        chequeo(
          'variables',
          { estado: ESTADO.FRENA, detalle: 'X falta', remedio: 'agregala' },
          { guia: GUIAS.VARIABLES }
        ),
      ],
      { url: 'https://repo/docs/guia.md' }
    )
    assert.include(lineas, '  variables: https://repo/docs/guia.md#variables-de-entorno')
  })
})

test.group('hooks · salida · rangos', () => {
  test('junta las líneas seguidas', ({ assert }) => {
    assert.equal(rangos([2]), '2')
    assert.equal(rangos([1, 2, 3, 7, 9, 10]), '1-3,7,9-10')
  })
})
