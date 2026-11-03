import { test } from './japa.mjs'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { SALIDA, ejecutar } from '../src/salida.mjs'
import { coberturaAlCommitear, coberturaAlSubir } from '../src/cobertura.mjs'

const RESUMEN = "console.log('Tests  1 passed (1)')"
const SALTAR = { SKIP: 'cobertura', HOOKS_SKIP: 'cobertura' }

test.group('hooks · cobertura · en un repo', (group) => {
  const original = process.cwd()
  const repo = mkdtempSync(join(tmpdir(), 'hooks-cobertura-'))
  const enRepo = (...args) =>
    execFileSync('git', ['-c', 'user.email=prueba@local', '-c', 'user.name=prueba', ...args], {
      cwd: repo,
      encoding: 'utf8',
    })
  const escribir = (ruta, texto) => {
    mkdirSync(dirname(join(repo, ruta)), { recursive: true })
    writeFileSync(join(repo, ruta), texto)
  }
  const commitear = (mensaje) => {
    enRepo('add', '-A')
    enRepo('commit', '-q', '-m', mensaje)
  }
  const servicio = 'export function sumar(a: number): number {\n  return a + 1\n}\n'
  const conOtra = `${servicio}\nexport function restar(a: number): number {\n  const menos = a - 1\n  return menos\n}\n`
  const correrTests = (llamadas) =>
    `const { ${llamadas.join(', ')} } = await import('../app/services/calculo.ts')\n${llamadas.map((nombre) => `${nombre}(1)`).join('\n')}\n${RESUMEN}\n`

  function armar({ dependencias = {} } = {}) {
    for (const entrada of readdirSync(repo))
      rmSync(join(repo, entrada), { recursive: true, force: true })
    enRepo('init', '-q', '-b', 'develop')
    symlinkSync(join(original, 'node_modules'), join(repo, 'node_modules'))
    escribir('.gitignore', 'node_modules\n')
    const manifiesto = {
      name: 'sag.laboratorio.api.prueba',
      type: 'module',
      imports: { '#services/*': './app/services/*.js' },
      scripts: { test: 'node tests/correr.mjs' },
      dependencies: dependencias,
      devDependencies: { c8: '^10' },
      hooks: {
        ramaBase: 'origin/develop',
        cobertura: { incluye: 'app/**', nuevos: String.raw`^app/(?:services|modules)/.+\.ts$` },
      },
    }
    escribir('package.json', `${JSON.stringify(manifiesto, null, 2)}\n`)
    escribir('app/services/calculo.ts', servicio)
    escribir('tests/correr.mjs', correrTests(['sumar']))
    commitear('chore: base')
    enRepo('update-ref', 'refs/remotes/origin/develop', 'HEAD')
    enRepo('checkout', '-q', '-b', 'feature/27005_x')
  }

  async function correr(chequeo, entorno = {}) {
    const escrito = []
    const codigo = await ejecutar({
      etapa: 'prueba',
      repo: 'api.prueba',
      chequeos: () => [chequeo],
      entorno,
      color: false,
      escribir: (texto) => escrito.push(texto),
    })
    return { codigo, texto: escrito.join('') }
  }

  function medir(entorno = {}) {
    const script = join(original, 'src/tests-si-hay-infra.mjs')
    execFileSync(process.execPath, [script], {
      cwd: repo,
      stdio: 'pipe',
      env: { ...process.env, ...entorno },
    })
  }

  group.setup(() => {
    process.chdir(repo)
    return () => {
      process.chdir(original)
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('al commitear, un servicio nuevo sin un spec que lo importe avisa, y no se salta', async ({
    assert,
  }) => {
    armar()
    escribir('app/services/nuevo.ts', 'export const uno = 1\n')
    enRepo('add', '-A')
    const { codigo, texto } = await correr(coberturaAlCommitear, SALTAR)
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.include(texto, '⚠ cobertura    app/services/nuevo.ts  nuevo, sin un spec que lo importe')
  })

  test('al commitear, con un spec que lo importa por alias o por ruta, pasa', async ({
    assert,
  }) => {
    armar()
    escribir('app/services/nuevo.ts', 'export const uno = 1\n')
    escribir('app/modules/x/x.service.ts', 'export const dos = 2\n')
    escribir('tests/unit/nuevo.spec.ts', "import { uno } from '#services/nuevo'\n")
    escribir('tests/unit/x.spec.ts', "import { dos } from '../../app/modules/x/x.service.js'\n")
    enRepo('add', '-A')
    const { texto } = await correr(coberturaAlCommitear)
    assert.include(texto, '✔ cobertura    2 archivos nuevos con su spec')
  })

  test('al commitear, un DTO nuevo es solo tipos: no cuenta', async ({ assert }) => {
    armar()
    escribir('app/modules/x/x.dto.ts', 'export interface X { a: number }\n')
    enRepo('add', '-A')
    const { texto } = await correr(coberturaAlCommitear)
    assert.include(
      texto,
      '– cobertura    saltado: ningún archivo nuevo que calce con ^app/(?:services|modules)/.+\\.ts$'
    )
  })

  test('al pushear, una función nueva sin test frena con sus líneas, y no se salta', async ({
    assert,
  }) => {
    armar()
    escribir('app/services/calculo.ts', conOtra)
    commitear('feat(#27005): restar')
    medir()
    const { codigo, texto } = await correr(coberturaAlSubir, SALTAR)
    assert.equal(codigo, SALIDA.ENCONTRO)
    assert.include(texto, '✖ cobertura    app/services/calculo.ts:6-8  3 líneas nuevas sin cubrir')
  }).timeout(60_000)

  test('al pushear, con su test pasa y dice cuántas líneas midió', async ({ assert }) => {
    armar()
    escribir('app/services/calculo.ts', conOtra)
    escribir('tests/correr.mjs', correrTests(['sumar', 'restar']))
    commitear('feat(#27005): restar con test')
    medir()
    const { codigo, texto } = await correr(coberturaAlSubir)
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.include(texto, '✔ cobertura    4 líneas nuevas, todas cubiertas')
  }).timeout(60_000)

  test('al pushear, una constante nueva en start/ no cuenta', async ({ assert }) => {
    armar()
    escribir('start/constantes.ts', 'export const TOPE = 10\n')
    commitear('feat(#27005): tope')
    medir()
    const { codigo, texto } = await correr(coberturaAlSubir)
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.include(texto, '✔ cobertura    0 líneas nuevas en app/** para cubrir')
  }).timeout(60_000)

  test('al pushear sin Redis no se pudo medir: avisa y dice por qué', async ({ assert }) => {
    armar({ dependencias: { '@adonisjs/redis': '^9' } })
    escribir('app/services/calculo.ts', conOtra)
    commitear('feat(#27005): restar')
    const cerrado = await new Promise((resolver) => {
      const sondeo = createServer()
      sondeo.listen(0, () => {
        const { port } = sondeo.address()
        sondeo.close(() => resolver(port))
      })
    })
    medir({ REDIS_HOST: '127.0.0.1', REDIS_PORT: String(cerrado) })
    const { codigo, texto } = await correr(coberturaAlSubir)
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.match(
      texto,
      /^⚠ cobertura {4}no se pudo medir: tests saltados: sin Redis en 127\.0\.0\.1:\d+$/m
    )
  }).timeout(60_000)

  test('al pushear, una medición de otro commit no vale', async ({ assert }) => {
    armar()
    medir()
    escribir('app/services/calculo.ts', conOtra)
    commitear('feat(#27005): restar después de medir')
    const { texto } = await correr(coberturaAlSubir)
    assert.match(texto, /^⚠ cobertura {4}no se pudo medir: /m)
  }).timeout(60_000)
})
