import { test } from './japa.mjs'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ESTADO, SALIDA, ejecutar } from '../src/salida.mjs'
import { filasDeSonar, sonar } from '../src/sonar.mjs'

const CONFIG_SONAR = 'eslint.sonar.config.js'
const CONFIG_DEL_EQUIPO = 'eslint.config.js'

async function salidaDe(chequeo) {
  const escrito = []
  const codigo = await ejecutar({
    etapa: 'pre-commit',
    repo: 'api.bff',
    chequeos: () => [chequeo],
    entorno: {},
    color: false,
    escribir: (texto) => escrito.push(texto),
  })
  return { codigo, texto: escrito.join('') }
}

test.group('hooks · sonar · qué fila sale', () => {
  test('sin .ts staged se salta y lo dice', ({ assert }) => {
    assert.deepEqual(filasDeSonar({ archivos: [], peores: [] }), [
      { estado: ESTADO.SALTADO, detalle: 'saltado: ningún .ts staged' },
    ])
  })

  test('si ninguno empeora pasa, con el denominador', ({ assert }) => {
    assert.deepEqual(filasDeSonar({ archivos: [{}, {}], peores: [] }), [
      { estado: ESTADO.PASA, detalle: '0 issues nuevos contra HEAD en 2 archivos .ts' },
    ])
  })

  test('el que empeora avisa con sus líneas, las reglas que subieron y la complejidad, y el commit sale', async ({
    assert,
  }) => {
    const peor = {
      ruta: 'app/x.ts',
      subieron: [{ regla: 'sonarjs/cognitive-complexity', previo: 0, cantidad: 1 }],
      complejidadSubio: true,
      antes: { complejidad: 0 },
      ahora: { complejidad: 21 },
      lineasNuevas: [{ line: 4 }, { line: 2 }, { line: 3 }, { line: 3 }],
    }
    const filas = filasDeSonar({ archivos: [{}], peores: [peor] })
    const { codigo, texto } = await salidaDe({ nombre: 'sonar', correr: () => filas })
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.include(
      texto,
      '⚠ sonar        app/x.ts:2-4  sonarjs/cognitive-complexity 0 → 1 · complejidad 0 → 21'
    )
    assert.match(texto, /^ {2}sonar +.*al pushear frena/m)
  })

  test('si solo subió la complejidad, no inventa líneas', ({ assert }) => {
    const peor = {
      ruta: 'app/x.ts',
      subieron: [],
      complejidadSubio: true,
      antes: { complejidad: 18 },
      ahora: { complejidad: 22 },
      lineasNuevas: [],
    }
    const [fila] = filasDeSonar({ archivos: [{}], peores: [peor] })
    assert.equal(fila.detalle, 'app/x.ts  complejidad 18 → 22')
  })
})

test.group('hooks · sonar · en un repo', (group) => {
  const original = process.cwd()
  const repo = mkdtempSync(join(tmpdir(), 'hooks-sonar-'))
  const enRepo = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
  const escribir = (ruta, texto) => writeFileSync(join(repo, ruta), texto)
  const simple = 'export function f(a: number): number {\n  return a\n}\n'
  const anidados = ['a > 1', 'a > 2', 'a > 3', 'a > 4', 'a > 5', 'a > 6']
  const complejo = `export function f(a: number): number {\n${anidados.map((condicion) => `if (${condicion}) {`).join('\n')}\nreturn a\n${'}\n'.repeat(anidados.length)}return 0\n}\n`

  const commitear = (mensaje) => {
    enRepo('add', '.')
    enRepo('-c', 'user.email=prueba@local', '-c', 'user.name=prueba', 'commit', '-q', '-m', mensaje)
  }

  function armar({ conConfig = true, cambio = complejo, enRama = false, conBase = true } = {}) {
    for (const entrada of readdirSync(repo))
      rmSync(join(repo, entrada), { recursive: true, force: true })
    enRepo('init', '-q')
    symlinkSync(join(original, 'node_modules'), join(repo, 'node_modules'))
    escribir('.gitignore', 'node_modules\n')
    if (conConfig) copyFileSync(join(original, CONFIG_SONAR), join(repo, CONFIG_SONAR))
    copyFileSync(join(original, CONFIG_DEL_EQUIPO), join(repo, CONFIG_DEL_EQUIPO))
    copyFileSync(join(original, 'tsconfig.json'), join(repo, 'tsconfig.json'))
    escribir(
      'package.json',
      '{\n  "name": "repo.de.prueba",\n  "type": "module",\n  "hooks": { "ramaBase": "origin/develop" }\n}\n'
    )
    mkdirSync(join(repo, 'app'))
    escribir('app/x.ts', simple)
    commitear('base')
    if (conBase) enRepo('update-ref', 'refs/remotes/origin/develop', 'HEAD')
    escribir('app/x.ts', cambio)
    if (enRama) commitear('feat: el cambio')
    else enRepo('add', '.')
  }

  group.setup(() => {
    process.chdir(repo)
    return () => {
      process.chdir(original)
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('al commitear, Sonar que empeora avisa y el commit sale; importar el script no lo corre', async ({
    assert,
  }) => {
    armar()
    const exitAntes = process.exitCode
    const { codigo, texto } = await salidaDe(sonar)
    assert.equal(process.exitCode, exitAntes)
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.match(texto, /⚠ sonar {8}app\/x\.ts:\d+ {2}sonarjs\/cognitive-complexity 0 → 1/)
  }).timeout(60_000)

  function hook(script, ...args) {
    try {
      const texto = execFileSync(process.execPath, [join(original, 'src', script), ...args], {
        cwd: repo,
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, NO_COLOR: '1' },
      })
      return { codigo: 0, texto }
    } catch (error) {
      return { codigo: error.status, texto: `${error.stdout}${error.stderr}` }
    }
  }

  test('el pre-commit entero sale con Sonar en aviso', ({ assert }) => {
    armar()
    const { codigo, texto } = hook('al-commitear.mjs')
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.match(texto, /^⚠ sonar {8}app\/x\.ts/m)
    assert.include(
      texto,
      '– cobertura    saltado: ningún archivo nuevo que calce con ^src/.+\\.(?:ts|js|mjs)$'
    )
  }).timeout(60_000)

  test('el script solo, sin --base, mide lo staged contra HEAD y frena igual que antes', ({
    assert,
  }) => {
    armar()
    assert.equal(hook('sonar_check.mjs').codigo, SALIDA.ENCONTRO)
  }).timeout(60_000)

  test('al pushear, Sonar compara lo que cambió la rama contra origin/develop y frena', ({
    assert,
  }) => {
    armar({ enRama: true })
    const { codigo, texto } = hook('sonar_check.mjs', '--base', 'origin/develop')
    assert.equal(codigo, SALIDA.ENCONTRO)
    assert.include(texto, 'sonarjs/cognitive-complexity: 0 → 1')
    assert.include(texto, 'contra origin/develop')
  }).timeout(60_000)

  test('al pushear, una rama que no empeora pasa y dice contra qué midió', ({ assert }) => {
    armar({ enRama: true, cambio: `${simple}export const b = 2\n` })
    const { codigo, texto } = hook('sonar_check.mjs', '--base', 'origin/develop')
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.include(texto, '1 archivos .ts revisados contra origin/develop')
  }).timeout(60_000)

  test('al pushear sin origin/develop no pudo correr: sale 2', ({ assert }) => {
    armar({ enRama: true, conBase: false })
    assert.equal(hook('sonar_check.mjs', '--base', 'origin/develop').codigo, SALIDA.NO_PUDO)
  }).timeout(60_000)

  test('el lint del equipo, al pushear, frena solo lo que la rama empeora contra origin/develop', ({
    assert,
  }) => {
    armar({ enRama: true, cambio: simple.replace('return a', 'return a;;') })
    const peor = hook('lint-no-empeorar.mjs', '--base', 'origin/develop')
    assert.equal(peor.codigo, SALIDA.ENCONTRO)
    assert.include(peor.texto, 'prettier/prettier: 0 → 1')
    armar({ enRama: true, cambio: `${simple}export const b = 2\n` })
    assert.equal(hook('lint-no-empeorar.mjs', '--base', 'origin/develop').codigo, SALIDA.LIMPIO)
  }).timeout(60_000)

  test('sin eslint.sonar.config.js se salta y lo dice', async ({ assert }) => {
    armar({ conConfig: false })
    const { codigo, texto } = await salidaDe(sonar)
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.include(texto, `– sonar        saltado: sin ${CONFIG_SONAR}`)
  })
})
