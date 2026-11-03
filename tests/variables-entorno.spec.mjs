import { test } from './japa.mjs'
import { ESTADO, ejecutar } from '../src/salida.mjs'
import { revisarVariables, variables } from '../src/variables-entorno.mjs'

const ESQUEMA = 'start/env.ts'

function diffDelEsquema({ agregadas = [], borradas = [], desde = 41 }) {
  return [
    `diff --git a/${ESQUEMA} b/${ESQUEMA}`,
    'index 1111111..2222222 100644',
    `--- a/${ESQUEMA}`,
    `+++ b/${ESQUEMA}`,
    `@@ -${desde},${borradas.length} +${desde},${agregadas.length} @@`,
    ...borradas.map((linea) => `-${linea}`),
    ...agregadas.map((linea) => `+${linea}`),
    '',
  ].join('\n')
}

const CONSUL_CON_MAIL = "    { key: 'MAIL_HOST', value: config.app.mailHost },"
const INTERFACES_CON_MAIL = 'export interface AppConfig {\n  port: number\n  mailHost: string\n}'

function revisar({ agregadas, borradas, ejemplo = '', consul = '', interfaces = '', ...resto }) {
  return revisarVariables({
    rutas: [ESQUEMA],
    diff: diffDelEsquema({ agregadas, borradas }),
    ejemplo,
    consul,
    interfaces,
    ...resto,
  })
}

test.group('hooks · variables · qué se mira', () => {
  test('sin start/env.ts staged se salta y dice por qué', ({ assert }) => {
    const filas = revisarVariables({
      rutas: ['app/x.ts'],
      diff: '',
      ejemplo: '',
      consul: '',
      interfaces: '',
    })
    assert.deepEqual(filas, [
      { estado: ESTADO.SALTADO, detalle: 'saltado: start/env.ts sin cambios' },
    ])
  })

  test('una clave que ya existía y cambió no es nueva; NODE_ENV se exceptúa', ({ assert }) => {
    const filas = revisar({
      borradas: ['  PORT: Env.schema.number(),'],
      agregadas: [
        '  PORT: Env.schema.number.optional(),',
        "  NODE_ENV: Env.schema.enum(['local', 'dev'] as const),",
        '  // un comentario',
      ],
    })
    assert.deepEqual(filas, [{ estado: ESTADO.PASA, detalle: '0 claves nuevas en start/env.ts' }])
  })
})

test.group('hooks · variables · obligatoria', () => {
  test('con .env.example, consul.ts e interfaces.ts pasa, con la cifra', ({ assert }) => {
    const filas = revisar({
      agregadas: ["  MAIL_HOST: Env.schema.string({ format: 'host' }),"],
      ejemplo: 'PORT=\nMAIL_HOST=\n',
      consul: CONSUL_CON_MAIL,
      interfaces: INTERFACES_CON_MAIL,
    })
    assert.deepEqual(filas, [{ estado: ESTADO.PASA, detalle: '1 clave nueva en su lugar' }])
  })

  test('sin su línea en consul.ts avisa en el commit, con línea y qué falta', ({ assert }) => {
    const [fila] = revisar({
      agregadas: ["  MAIL_HOST: Env.schema.string({ format: 'host' }),"],
      ejemplo: 'MAIL_HOST=\n',
    })
    assert.equal(fila.estado, ESTADO.AVISA)
    assert.equal(fila.detalle, 'start/env.ts:41  MAIL_HOST obligatoria, falta en consul/consul.ts')
    assert.include(fila.remedio, '.optional()')
  })

  test('nombra cada lugar que falta: .env.example e interfaces.ts', ({ assert }) => {
    const [fila] = revisar({
      agregadas: ['  OTRA: Env.schema.string(),', '  MAIL_HOST: Env.schema.string(),'],
      ejemplo: 'OTRA=\nMAIL_HOSTS=\n',
      consul: `${CONSUL_CON_MAIL}\n    { key: 'OTRA', value: config.app.otra },`,
      interfaces: 'export interface AppConfig {\n  otra: string\n  mailHostX: string\n}',
    })
    assert.equal(
      fila.detalle,
      'start/env.ts:42  MAIL_HOST obligatoria, falta en .env.example · consul/interfaces.ts'
    )
  })

  test('el campo se lee de la línea de consul.ts, sea cual sea la sección', ({ assert }) => {
    const filas = revisar({
      agregadas: ['  REDIS_DB: Env.schema.number(),'],
      ejemplo: 'REDIS_DB=\n',
      consul: "    { key: 'REDIS_DB', value: redisConfig.db },",
      interfaces: 'export interface RedisConfig {\n  db?: number\n}',
    })
    assert.equal(filas[0].estado, ESTADO.PASA)
  })

  test('al pushear la misma falta frena', ({ assert }) => {
    const [fila] = revisar({
      agregadas: ['  MAIL_HOST: Env.schema.string(),'],
      faltaObligatoria: ESTADO.FRENA,
    })
    assert.equal(fila.estado, ESTADO.FRENA)
  })
})

test.group('hooks · variables · opcional', () => {
  test('sin Consul avisa con otro texto', ({ assert }) => {
    const [fila] = revisar({ agregadas: ['  MAIL_DEBUG: Env.schema.boolean.optional(),'] })
    assert.equal(fila.estado, ESTADO.AVISA)
    assert.equal(fila.detalle, 'start/env.ts:41  MAIL_DEBUG no está en Consul')
    assert.equal(fila.remedio, 'si es solo local, está bien; si va a dev, agregala')
  })

  test('al pushear sigue avisando', ({ assert }) => {
    const [fila] = revisar({
      agregadas: ['  MAIL_DEBUG: Env.schema.boolean.optional(),'],
      faltaObligatoria: ESTADO.FRENA,
    })
    assert.equal(fila.estado, ESTADO.AVISA)
  })

  test('en Consul pasa, aunque no esté en .env.example', ({ assert }) => {
    const filas = revisar({
      agregadas: ['  MAIL_DEBUG: Env.schema.boolean.optional(),'],
      consul: "    { key: 'MAIL_DEBUG', value: config.app.mailDebug },",
    })
    assert.deepEqual(filas, [{ estado: ESTADO.PASA, detalle: '1 clave nueva en su lugar' }])
  })
})

test.group('hooks · variables · la fila', () => {
  test('se ve con la guía de variables y se apaga desde package.json', async ({ assert }) => {
    const chequeo = {
      ...variables,
      correr: () => revisar({ agregadas: ['  MAIL_DEBUG: Env.schema.boolean.optional(),'] }),
    }
    const correr = async (opciones = {}) => {
      const escrito = []
      await ejecutar({
        etapa: 'pre-commit',
        repo: 'api.bff',
        chequeos: () => [chequeo],
        entorno: {},
        ...opciones,
        color: false,
        escribir: (texto) => escrito.push(texto),
      })
      return escrito.join('')
    }
    const conAviso = await correr({})
    assert.include(conAviso, '⚠ variables    start/env.ts:41  MAIL_DEBUG no está en Consul')
    assert.match(conAviso, /^ {2}variables +si es solo local.* +guía: variables$/m)
    assert.include(conAviso, 'variables: https://')
    assert.include(
      await correr({ apagados: ['variables'] }),
      '– variables    apagado en package.json (hooks.apagados)'
    )
  })
})
