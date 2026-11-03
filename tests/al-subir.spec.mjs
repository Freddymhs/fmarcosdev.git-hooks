import { test } from './japa.mjs'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { SALIDA, ejecutar } from '../src/salida.mjs'
import { chequeosAlSubir } from '../src/al-subir.chequeos.mjs'
import { filaDeCheck } from '../src/check.mjs'

const RAMA = 'feature/27005_husky'
const PASA = 'node -e 0'
const FALLA = 'node -e "process.exit(1)"'

test.group('hooks · al subir · la fila de check', () => {
  test('lee los pasos con el formato de npm 10 y con el de npm 12', ({ assert }) => {
    const npm10 =
      '> x@1.0.0 check\n> npm run a && npm test\n\n> x@1.0.0 a\n> tsc\n\n> x@1.0.0 test\nTests  218 passed, 12 failed (230)\n'
    const npm12 = npm10.replaceAll('> x@', 'npm notice run x@')
    for (const salida of [npm10, npm12]) {
      assert.deepEqual(filaDeCheck({ codigo: 1, salida }), {
        estado: 'frena',
        detalle: 'falló en test, después de a',
        remedio: 'npm run test: ahí está el detalle',
      })
      assert.equal(filaDeCheck({ codigo: 0, salida }).detalle, 'a · tests 218/230')
    }
  })
})

test.group('hooks · al subir · en un repo', (group) => {
  const original = process.cwd()
  const repo = mkdtempSync(join(tmpdir(), 'hooks-subir-'))
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
    enRepo('commit', '-q', '--allow-empty', '-m', mensaje)
  }
  const manifiesto = ({ version = '1.0.0', scripts = { check: PASA } } = {}) =>
    `${JSON.stringify({ name: 'sag.laboratorio.api.prueba', version, scripts, hooks: { exigeVersion: true, ramaBase: 'origin/develop', variables: { registro: { mapeo: 'consul/consul.ts', interfaces: 'consul/interfaces.ts' } } } }, null, 2)}\n`
  const lock = (version) =>
    `${JSON.stringify({ name: 'sag.laboratorio.api.prueba', version, lockfileVersion: 3, packages: { '': { version } } }, null, 2)}\n`
  const subirVersion = (version = '1.0.1', scripts) => {
    escribir('package.json', manifiesto({ version, scripts }))
    escribir('package-lock.json', lock(version))
  }

  function armar({ rama = RAMA, conBase = true } = {}) {
    for (const entrada of readdirSync(repo))
      rmSync(join(repo, entrada), { recursive: true, force: true })
    enRepo('init', '-q', '-b', 'develop')
    subirVersion('1.0.0')
    escribir(
      'start/env.ts',
      "export default await Env.create(new URL('../', import.meta.url), {\n  PORT: Env.schema.number(),\n})\n"
    )
    escribir('.env.example', 'PORT=3333\n')
    escribir('consul/consul.ts', "    { key: 'PORT', value: config.app.port },\n")
    escribir('consul/interfaces.ts', 'export interface AppConfig {\n  port: number\n}\n')
    escribir('app/a.ts', 'export const a = 1\n')
    commitear('chore: base')
    if (conBase) enRepo('update-ref', 'refs/remotes/origin/develop', 'HEAD')
    enRepo('checkout', '-q', '-b', rama)
  }

  async function correr() {
    const escrito = []
    const codigo = await ejecutar({
      etapa: 'pre-push',
      repo: 'api.prueba',
      chequeos: () => chequeosAlSubir(),
      entorno: {},
      color: false,
      escribir: (texto) => escrito.push(texto),
    })
    return { codigo, texto: escrito.join('') }
  }

  function hook(...args) {
    try {
      const texto = execFileSync(process.execPath, [join(original, 'src/al-subir.mjs'), ...args], {
        cwd: repo,
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, NO_COLOR: '1' },
      })
      return { codigo: 0, texto }
    } catch (error) {
      return { codigo: error.status, texto: `${error.stdout}` }
    }
  }

  group.setup(() => {
    process.chdir(repo)
    return () => {
      process.chdir(original)
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('la rama al día, con tipo, #task y versión subida: todo pasa', async ({ assert }) => {
    armar()
    subirVersion()
    commitear('feat(#27005): algo')
    const { codigo, texto } = await correr()
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.include(texto, '✔ limpio       sin cambios sin commitear')
    assert.include(texto, '✔ commits      1 commit con tipo')
    assert.include(texto, '✔ #task        #27005 en 1 commit')
    assert.include(texto, '– variables    saltado: start/env.ts sin cambios')
    assert.include(texto, '✔ versión      1.0.1 > develop 1.0.0')
    assert.include(texto, '✔ rama         27005')
    assert.include(texto, '✔ atraso       al día con origin/develop')
    assert.include(texto, '✔ check        ')
    assert.include(texto, '⚠ cobertura    no se pudo medir: no hay una medición de este commit')
  })

  test('un archivo trackeado sin commitear frena; uno nuevo sin agregar avisa; check no corre', async ({
    assert,
  }) => {
    armar()
    subirVersion()
    commitear('feat(#27005): algo')
    escribir('app/a.ts', 'export const a = 2\n')
    escribir('app/suelto.ts', 'export const b = 1\n')
    const { codigo, texto } = await correr()
    assert.equal(codigo, SALIDA.ENCONTRO)
    assert.include(texto, '✖ limpio       app/a.ts modificado sin commitear')
    assert.include(texto, '⚠ limpio       app/suelto.ts sin agregar')
    assert.include(texto, '– check        no corre: lo que probaría no es lo que se sube')
    assert.match(
      texto,
      /^ {2}limpio +commiteá o descartá app\/a\.ts: lo que se prueba es lo que se sube/m
    )
  })

  test('un commit wip o sin tipo avisa, y el que no nombra la task también; los merges no cuentan', async ({
    assert,
  }) => {
    armar()
    subirVersion()
    commitear('wip cosas')
    commitear('fix(#27005): arreglo')
    commitear('Merge branch develop')
    const { codigo, texto } = await correr()
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.include(texto, '⚠ commits      1 de 2 wip o sin tipo')
    assert.include(texto, '⚠ #task        1 de 2 sin #27005')
    assert.match(texto, /^ {2}commits +antes del PR, git rebase -i origin\/develop/m)
  })

  test('una variable obligatoria nueva sin Consul frena', async ({ assert }) => {
    armar()
    subirVersion()
    escribir(
      'start/env.ts',
      "export default await Env.create(new URL('../', import.meta.url), {\n  PORT: Env.schema.number(),\n  MAIL_HOST: Env.schema.string(),\n})\n"
    )
    commitear('feat(#27005): mail')
    const { codigo, texto } = await correr()
    assert.equal(codigo, SALIDA.ENCONTRO)
    assert.include(
      texto,
      '✖ variables    start/env.ts:3  MAIL_HOST obligatoria, falta en .env.example · consul/consul.ts'
    )
  })

  test('la versión igual a develop frena con el comando; el lock distinto también', async ({
    assert,
  }) => {
    armar()
    commitear('feat(#27005): sin subir')
    const igual = await correr()
    assert.equal(igual.codigo, SALIDA.ENCONTRO)
    assert.include(igual.texto, '✖ versión      1.0.0 no es mayor que develop 1.0.0')
    assert.match(igual.texto, /^ {2}versión +npm version patch --no-git-tag-version/m)
    escribir('package.json', manifiesto({ version: '1.0.1' }))
    commitear('feat(#27005): sin el lock')
    const { texto } = await correr()
    assert.include(texto, '✖ versión      package-lock.json dice 1.0.0 y package.json 1.0.1')
  })

  test('rama sin número de task avisa y el #task se salta', async ({ assert }) => {
    armar({ rama: 'feature/arreglos' })
    subirVersion()
    commitear('fix: arreglo')
    const { codigo, texto } = await correr()
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.include(texto, '⚠ rama         «feature/arreglos» sin número de task')
    assert.include(texto, '– #task        la rama no tiene número de task')
  })

  test('atrasada respecto de origin/develop avisa, sin hacer fetch', async ({ assert }) => {
    armar()
    enRepo('checkout', '-q', 'develop')
    commitear('feat(#1): otro')
    enRepo('update-ref', 'refs/remotes/origin/develop', 'HEAD')
    enRepo('checkout', '-q', RAMA)
    subirVersion()
    commitear('feat(#27005): algo')
    const { texto } = await correr()
    assert.include(texto, '⚠ atraso       1 commit atrás de origin/develop')
  })

  test('sin origin/develop avisa en lo que compara contra ella', async ({ assert }) => {
    armar({ conBase: false })
    commitear('feat(#27005): algo')
    const { texto } = await correr()
    assert.include(texto, '⚠ atraso       sin origin/develop: no se pudo comparar')
    assert.include(texto, '⚠ commits      sin origin/develop: no se pudo comparar')
    assert.include(texto, '⚠ versión      sin origin/develop: no se pudo comparar')
  })

  test('check en rojo frena y nombra el paso que falló', async ({ assert }) => {
    armar()
    subirVersion('1.0.1', {
      check: 'npm run uno && npm run dos && npm run tres',
      uno: PASA,
      dos: FALLA,
      tres: PASA,
    })
    commitear('feat(#27005): algo')
    const { codigo, texto } = await correr()
    assert.equal(codigo, SALIDA.ENCONTRO)
    assert.include(texto, '✖ check        falló en dos, después de uno')
    assert.match(texto, /^ {2}check +npm run dos: ahí está el detalle/m)
  })

  test('check en verde nombra sus pasos y el resumen de los tests', async ({ assert }) => {
    armar()
    const tests = 'node -e "console.log(String.fromCharCode(84)+\'ests  3 passed (3)\')"'
    subirVersion('1.0.1', { check: 'npm run uno && npm test', uno: PASA, test: tests })
    commitear('feat(#27005): algo')
    const { texto } = await correr()
    assert.include(texto, '✔ check        uno · tests 3/3')
  })

  test('el hook entero: encabezado con rama y remoto, y su exit', ({ assert }) => {
    armar()
    commitear('feat(#27005): sin subir')
    const { codigo, texto } = hook('origin')
    assert.equal(codigo, SALIDA.ENCONTRO)
    assert.match(texto, /^husky · pre-push · api\.prueba · feature\/27005_husky → origin$/m)
  })
})
