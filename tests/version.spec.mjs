import { test } from './japa.mjs'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ESTADO, ejecutar } from '../src/salida.mjs'
import { decidirVersion, version } from '../src/version.mjs'

test.group('hooks · versión · qué decide', () => {
  test('sin la clave del repo se salta', ({ assert }) => {
    assert.deepEqual(decidirVersion({ exige: false, propia: '1.8.9', base: '1.8.9' }), {
      estado: ESTADO.SALTADO,
      detalle: 'saltado: el repo no la exige',
    })
  })

  test('mayor que develop pasa, comparando por número y no por texto', ({ assert }) => {
    assert.deepEqual(decidirVersion({ exige: true, propia: '1.8.10', base: '1.8.9' }), {
      estado: ESTADO.PASA,
      detalle: '1.8.10 > main 1.8.9',
    })
    assert.equal(
      decidirVersion({ exige: true, propia: '2.0.0', base: '1.12.3' }).estado,
      ESTADO.PASA
    )
  })

  test('igual o menor que develop: la siguiente es un patch sobre develop', ({ assert }) => {
    assert.equal(
      decidirVersion({ exige: true, propia: '1.8.9', base: '1.8.9' }).siguiente,
      '1.8.10'
    )
    assert.equal(
      decidirVersion({ exige: true, propia: '1.8.9', base: '1.8.11' }).siguiente,
      '1.8.12'
    )
  })

  test('sin develop avisa y no escribe', ({ assert }) => {
    const fila = decidirVersion({ exige: true, propia: '1.8.9', base: null })
    assert.equal(fila.estado, ESTADO.AVISA)
    assert.isUndefined(fila.siguiente)
    assert.isString(fila.remedio)
  })
})

test.group('hooks · versión · en un repo', (group) => {
  const original = process.cwd()
  const repo = mkdtempSync(join(tmpdir(), 'hooks-version-'))
  const enRepo = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
  const manifiesto = (numero, exige) =>
    `${JSON.stringify({ name: 'x', version: numero, hooks: { ramaBase: 'origin/develop', ...(exige ? { exigeVersion: true } : {}) } }, null, 2)}\n`
  const lock = (numero) =>
    `${JSON.stringify({ name: 'x', version: numero, lockfileVersion: 3, requires: true, packages: { '': { name: 'x', version: numero } } }, null, 2)}\n`
  const escribir = (archivo, texto) => writeFileSync(join(repo, archivo), texto)
  const enElIndice = (archivo) => JSON.parse(enRepo('show', `:${archivo}`)).version

  function armar({ develop, propia, exige = true, conDevelop = true }) {
    rmSync(join(repo, '.git'), { recursive: true, force: true })
    enRepo('init', '-q')
    escribir('package.json', manifiesto(develop, exige))
    escribir('package-lock.json', lock(develop))
    enRepo('add', '.')
    enRepo('-c', 'user.email=prueba@local', '-c', 'user.name=prueba', 'commit', '-q', '-m', 'base')
    if (conDevelop) enRepo('update-ref', 'refs/remotes/origin/develop', 'HEAD')
    escribir('package.json', manifiesto(propia, exige))
    escribir('package-lock.json', lock(propia))
    enRepo('add', '.')
  }

  async function correr(entorno = {}, antes = []) {
    const escrito = []
    const codigo = await ejecutar({
      etapa: 'pre-commit',
      repo: 'api.bff',
      chequeos: () => [...antes, version],
      entorno,
      color: false,
      escribir: (texto) => escrito.push(texto),
    })
    return { codigo, texto: escrito.join('') }
  }

  group.setup(() => {
    process.chdir(repo)
    return () => {
      process.chdir(original)
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('igual a develop: la sube un patch, la stagea con el lock y lo dice', async ({ assert }) => {
    armar({ develop: '1.8.9', propia: '1.8.9' })
    const { codigo, texto } = await correr()
    assert.equal(codigo, 0)
    assert.include(texto, '⬆ versión      1.8.9 → 1.8.10, subida en este commit')
    assert.equal(enElIndice('package.json'), '1.8.10')
    assert.equal(enElIndice('package-lock.json'), '1.8.10')
    assert.equal(enRepo('diff', '--name-only'), '')
  })

  test('ya mayor que develop: no escribe nada', async ({ assert }) => {
    armar({ develop: '1.8.9', propia: '1.9.0' })
    const antes = readFileSync(join(repo, 'package.json'), 'utf8')
    const { texto } = await correr()
    assert.include(texto, '✔ versión      1.9.0 > develop 1.8.9')
    assert.equal(readFileSync(join(repo, 'package.json'), 'utf8'), antes)
  })

  test('sin la clave del repo no escribe nada', async ({ assert }) => {
    armar({ develop: '1.8.9', propia: '1.8.9', exige: false })
    const { texto } = await correr()
    assert.include(texto, '– versión      saltado: el repo no la exige')
    assert.equal(enElIndice('package.json'), '1.8.9')
  })

  test('con package.json cambiado sin stagear avisa y no lo pisa', async ({ assert }) => {
    armar({ develop: '1.8.9', propia: '1.8.9' })
    escribir('package.json', manifiesto('1.8.9', true).replace('"x"', '"y"'))
    const { codigo, texto } = await correr()
    assert.equal(codigo, 0)
    assert.include(texto, '⚠ versión      package.json con cambios sin stagear: no la subo')
    assert.equal(enElIndice('package.json'), '1.8.9')
    assert.include(readFileSync(join(repo, 'package.json'), 'utf8'), '"y"')
  })

  test('si un chequeo anterior frena o no pudo correr, no la sube', async ({ assert }) => {
    for (const estado of [ESTADO.FRENA, ESTADO.ERROR]) {
      armar({ develop: '1.8.9', propia: '1.8.9' })
      const frenador = {
        nombre: 'secretos',
        correr: () => ({ estado, detalle: 'x', remedio: 'y' }),
      }
      const { texto } = await correr({}, [frenador])
      assert.include(texto, '– versión      no se sube: el commit no sale', estado)
      assert.equal(enElIndice('package.json'), '1.8.9', estado)
    }
  })

  test('un aviso anterior no la frena', async ({ assert }) => {
    armar({ develop: '1.8.9', propia: '1.8.9' })
    const avisador = {
      nombre: 'variables',
      correr: () => ({ estado: ESTADO.AVISA, detalle: 'x', remedio: 'y' }),
    }
    await correr({}, [avisador])
    assert.equal(enElIndice('package.json'), '1.8.10')
  })

  test('sin origin/develop avisa, no escribe y sale 0', async ({ assert }) => {
    armar({ develop: '1.8.9', propia: '1.8.9', conDevelop: false })
    const { codigo, texto } = await correr()
    assert.equal(codigo, 0)
    assert.include(texto, '⚠ versión      sin origin/develop: no se pudo comparar')
    assert.equal(enElIndice('package.json'), '1.8.9')
  })
})
