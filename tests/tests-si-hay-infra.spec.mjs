import { test } from './japa.mjs'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { filaDeCheck } from '../src/check.mjs'
import { SALIDA } from '../src/salida.mjs'
import { dondeEstaRedis, necesidadesDe } from '../src/tests-si-hay-infra.mjs'

const RESUMEN = 'node -e "console.log(String.fromCharCode(84)+\'ests  3 passed (3)\')"'
const RESUMEN_CON_FALLAS =
  'node -e "console.log(String.fromCharCode(84)+\'ests  2 passed, 1 failed (3)\');process.exit(1)"'
const MUDO = 'node -e "process.exit(1)"'

test.group('hooks · tests · qué necesitan y dónde', () => {
  test('lo que necesitan los tests sale de las dependencias', ({ assert }) => {
    assert.deepEqual(necesidadesDe({ dependencies: { '@adonisjs/redis': '^9' } }), ['Redis'])
    assert.deepEqual(necesidadesDe({ devDependencies: { '@testcontainers/postgresql': '^10' } }), [
      'Docker',
    ])
    assert.deepEqual(necesidadesDe({ devDependencies: { testcontainers: '^10' } }), ['Docker'])
    assert.deepEqual(necesidadesDe({ dependencies: { luxon: '^3' } }), [])
  })

  test('Redis se busca donde lo buscan los tests: entorno, .env, .env.example', ({ assert }) => {
    const archivos = {
      '.env': 'REDIS_HOST=redis.local\nREDIS_PORT=6390\n',
      '.env.example': 'REDIS_PORT=6379\n',
    }
    const leer = (ruta) => archivos[ruta] ?? null
    assert.deepEqual(dondeEstaRedis({ entorno: {}, leer }), { host: 'redis.local', port: 6390 })
    assert.deepEqual(dondeEstaRedis({ entorno: { REDIS_PORT: '6391' }, leer }), {
      host: 'redis.local',
      port: 6391,
    })
    assert.deepEqual(
      dondeEstaRedis({ entorno: {}, leer: (ruta) => (ruta === '.env' ? null : archivos[ruta]) }),
      {
        host: 'localhost',
        port: 6379,
      }
    )
  })
})

test.group('hooks · tests · la fila de check', () => {
  test('tests saltados o sin resumen: check pasa con aviso y lo dice', ({ assert }) => {
    const salida = [
      'npm notice run x@1.0.0 check',
      'npm notice run x@1.0.0 typecheck',
      'npm notice run x@1.0.0 test:si-hay-infra',
      '⚠ tests saltados: sin Redis en localhost:6390',
    ].join('\n')
    assert.deepEqual(filaDeCheck({ codigo: 0, salida }), {
      estado: 'avisa',
      detalle: 'typecheck · tests saltados: sin Redis en localhost:6390',
      remedio: 'levantá lo que falta y corré npm test antes del PR',
    })
  })

  test('sin resumen el remedio apunta al runner, no a la infraestructura', ({ assert }) => {
    const salida =
      'npm notice run x@1.0.0 test:si-hay-infra\n⚠ tests sin resumen: npm test salió 1 sin imprimir su resultado\n'
    assert.deepEqual(filaDeCheck({ codigo: 0, salida }), {
      estado: 'avisa',
      detalle: 'tests sin resumen: npm test salió 1 sin imprimir su resultado',
      remedio: 'corré npm test a mano: node ace necesita Node 22',
    })
  })

  test('el paso de tests muestra su resumen aunque se llame distinto', ({ assert }) => {
    const salida =
      'npm notice run x@1.0.0 typecheck\nnpm notice run x@1.0.0 test:si-hay-infra\nTests  3 passed (3)\n'
    assert.equal(filaDeCheck({ codigo: 0, salida }).detalle, 'typecheck · tests 3/3')
  })
})

test.group('hooks · tests · en un repo', (group) => {
  const original = process.cwd()
  const repo = mkdtempSync(join(tmpdir(), 'hooks-tests-'))
  const servidor = createServer((conexion) => conexion.end())
  const puertoLibre = () => {
    const sondeo = createServer()
    return new Promise((resolver) =>
      sondeo.listen(0, () => {
        const { port } = sondeo.address()
        sondeo.close(() => resolver(port))
      })
    )
  }

  function armar({ test: comando, dependencias = { '@adonisjs/redis': '^9' }, puerto }) {
    for (const entrada of readdirSync(repo))
      rmSync(join(repo, entrada), { recursive: true, force: true })
    execFileSync('git', ['init', '-q'], { cwd: repo })
    const scripts = { test: `node -e "require('fs').writeFileSync('corrio','')" && ${comando}` }
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'x', version: '1.0.0', scripts, dependencies: dependencias })
    )
    writeFileSync(join(repo, '.env'), `REDIS_HOST=127.0.0.1\nREDIS_PORT=${puerto}\n`)
  }

  function correr() {
    const script = join(original, 'src/tests-si-hay-infra.mjs')
    const entorno = { ...process.env }
    delete entorno.REDIS_HOST
    delete entorno.REDIS_PORT
    try {
      return {
        codigo: 0,
        texto: execFileSync(process.execPath, [script], {
          cwd: repo,
          encoding: 'utf8',
          stdio: 'pipe',
          env: entorno,
        }),
      }
    } catch (error) {
      return { codigo: error.status, texto: `${error.stdout}${error.stderr}` }
    }
  }

  group.setup(async () => {
    await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver))
    return () => {
      servidor.close()
      rmSync(repo, { recursive: true, force: true })
    }
  })

  const redisArriba = () => servidor.address().port

  test('sin Redis no corre los tests: avisa dónde lo buscó y sale 0', async ({ assert }) => {
    armar({ test: RESUMEN, puerto: await puertoLibre() })
    const { codigo, texto } = correr()
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.match(texto, /^⚠ tests saltados: sin Redis en 127\.0\.0\.1:\d+$/m)
    assert.isFalse(existsSync(join(repo, 'corrio')))
  })

  test('con Redis corre los tests y deja su resumen', ({ assert }) => {
    armar({ test: RESUMEN, puerto: redisArriba() })
    const { codigo, texto } = correr()
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.include(texto, 'Tests  3 passed (3)')
    assert.isTrue(existsSync(join(repo, 'corrio')))
  })

  test('un test en rojo frena', ({ assert }) => {
    armar({ test: RESUMEN_CON_FALLAS, puerto: redisArriba() })
    assert.equal(correr().codigo, SALIDA.ENCONTRO)
  })

  test('si el runner no imprime su resumen, avisa y sale 0', ({ assert }) => {
    armar({ test: MUDO, puerto: redisArriba() })
    const { codigo, texto } = correr()
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.match(texto, /^⚠ tests sin resumen: npm test salió 1 sin imprimir su resultado$/m)
  })

  test('sin nada que levantar, corre los tests directo', async ({ assert }) => {
    armar({ test: RESUMEN, dependencias: {}, puerto: await puertoLibre() })
    const { codigo } = correr()
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.isTrue(existsSync(join(repo, 'corrio')))
  })
})
