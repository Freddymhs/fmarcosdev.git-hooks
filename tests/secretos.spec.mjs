import { test } from './japa.mjs'
import { ESTADO } from '../src/salida.mjs'
import { revisarSecretos } from '../src/secretos.mjs'

const pegar = (...partes) => partes.join('')

function diffDe(ruta, ...agregadas) {
  const cuerpo = agregadas.map((linea) => `+${linea}`).join('\n')
  return [
    `diff --git a/${ruta} b/${ruta}`,
    'index 1111111..2222222 100644',
    `--- a/${ruta}`,
    `+++ b/${ruta}`,
    `@@ -0,0 +1,${agregadas.length} @@`,
    cuerpo,
    '',
  ].join('\n')
}

function revisarLinea(linea) {
  return revisarSecretos({ rutas: ['config/mail.ts'], diff: diffDe('config/mail.ts', linea) })
}

test.group('hooks · secretos · qué frena', () => {
  test('sin nada sospechoso pasa, con la cifra de líneas revisadas', ({ assert }) => {
    const filas = revisarSecretos({
      rutas: ['config/mail.ts'],
      diff: diffDe('config/mail.ts', "env.get('DB_PASSWORD')", 'APP_KEY: Env.schema.string(),'),
    })
    assert.deepEqual(filas, [{ estado: ESTADO.PASA, detalle: '0 en 2 líneas agregadas' }])
  })

  test('el singular de la cifra', ({ assert }) => {
    assert.deepEqual(revisarLinea('const a = 1'), [
      { estado: ESTADO.PASA, detalle: '0 en 1 línea agregada' },
    ])
  })

  test('un token de npm frena, con archivo y línea, sin imprimir el valor', ({ assert }) => {
    const valor = 'npm_valorFalso123'
    const [fila] = revisarLinea(pegar('//registry.npmjs.org/:_auth', 'Token=', valor))
    assert.equal(fila.estado, ESTADO.FRENA)
    assert.equal(fila.detalle, pegar('config/mail.ts:1  _auth', 'Token= en una línea agregada'))
    assert.notInclude(fila.detalle, valor)
    assert.isString(fila.remedio)
  })

  test('cada forma de D9 frena', ({ assert }) => {
    const lineas = [
      pegar('//registry/:_pass', 'word=YWJj'),
      pegar('-----BEGIN RSA PRIV', 'ATE KEY-----'),
      pegar('ANTHROPIC = "sk-', 'ant-api03-falso"'),
      pegar('MINIMAX = "sk-', 'cp-falso"'),
      pegar('const API_TOK', "EN = 'abcdefghijklmnop'"),
      pegar('"client_SECR', 'ET": "abcdefghijklmnop"'),
    ]
    for (const linea of lineas) {
      const [fila] = revisarLinea(linea)
      assert.equal(fila.estado, ESTADO.FRENA, linea)
    }
  })

  test('la forma genérica no depende de mayúsculas', ({ assert }) => {
    const lineas = [
      pegar('const pass', 'word = "Sup3rS3cret0Real"'),
      pegar('apiTo', "ken: 'abcdefghijklmnop'"),
      pegar('client_sec', 'ret="abcdefghijklmnop"'),
    ]
    for (const linea of lineas) {
      const [fila] = revisarLinea(linea)
      assert.equal(fila.estado, ESTADO.FRENA, linea)
    }
  })

  test('una clave «key» sola o un nombre de variable como valor no son secretos', ({ assert }) => {
    const lineas = [
      '"key": "Content-Type-Header"',
      "    { key: 'REGIONALIZACION_API_URL', value: config.x.url },",
      "  apiEnvKey: 'NOTIFY_SERVICE_API_KEY',",
    ]
    for (const linea of lineas) {
      const [fila] = revisarLinea(linea)
      assert.equal(fila.estado, ESTADO.PASA, linea)
    }
    const [conAmbas] = revisarLinea(pegar("{ key: 'MAIL_HOST', pass", "word: 'abcdefghijklmnop' }"))
    assert.equal(conAmbas.estado, ESTADO.FRENA)
  })

  test('el valor genérico nombra la clave, no el valor', ({ assert }) => {
    const [fila] = revisarLinea(pegar('const API_TOK', "EN = 'abcdefghijklmnop'"))
    assert.equal(fila.detalle, 'config/mail.ts:1  API_TOKEN con un valor literal')
  })

  test('un valor corto o leído del entorno pasa', ({ assert }) => {
    const lineas = [
      pegar('const TOK', "EN = 'corto'"),
      'const token = env.get("API_TOKEN")',
      'APP_KEY: Env.schema.string(),',
    ]
    for (const linea of lineas) {
      const [fila] = revisarLinea(linea)
      assert.equal(fila.estado, ESTADO.PASA, linea)
    }
  })

  test('.env, .env.<x> y .npmrc staged frenan; los .example pasan', ({ assert }) => {
    const filas = revisarSecretos({
      rutas: ['.env', 'config/.env.local', '.npmrc', '.env.example', '.env.consul.example'],
      diff: '',
    })
    assert.deepEqual(
      filas.map(({ estado, detalle }) => ({ estado, detalle })),
      [
        { estado: ESTADO.FRENA, detalle: '.env  archivo sensible staged' },
        { estado: ESTADO.FRENA, detalle: 'config/.env.local  archivo sensible staged' },
        { estado: ESTADO.FRENA, detalle: '.npmrc  archivo sensible staged' },
      ]
    )
  })
})
