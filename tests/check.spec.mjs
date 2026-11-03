import { test } from './japa.mjs'
import { filaDeCheck, resumenDeTests } from '../src/check.mjs'
import { ESTADO } from '../src/salida.mjs'

const CORRIDA = (resumen) =>
  `> x@1.0.0 check\n> npm run lint && npm test\n\n> x@1.0.0 lint\n> eslint .\n\n> x@1.0.0 test\n> ${resumen}\n`

test.group('hooks · check · el resumen de los tests, según el runner', () => {
  test('Japa y Vitest: «Tests  N passed (M)»', ({ assert }) => {
    assert.deepEqual(resumenDeTests('Tests  140 passed (140)'), { pasaron: 140, total: 140 })
    assert.deepEqual(resumenDeTests(' Tests  3 passed, 2 failed (5)'), { pasaron: 3, total: 5 })
  })

  test('Jest: «Tests: N passed, M total»', ({ assert }) => {
    assert.deepEqual(resumenDeTests('Tests:       12 passed, 12 total'), { pasaron: 12, total: 12 })
    assert.deepEqual(resumenDeTests('Tests:       1 failed, 11 passed, 12 total'), {
      pasaron: 11,
      total: 12,
    })
  })

  test('node:test: «# tests N» y «# pass N»', ({ assert }) => {
    assert.deepEqual(resumenDeTests('# tests 122\n# suites 20\n# pass 122\n# fail 0'), {
      pasaron: 122,
      total: 122,
    })
  })

  test('Mocha: «N passing» y «M failing»', ({ assert }) => {
    assert.deepEqual(resumenDeTests('  7 passing (120ms)\n  2 failing'), { pasaron: 7, total: 9 })
    assert.deepEqual(resumenDeTests('  7 passing (120ms)'), { pasaron: 7, total: 7 })
  })

  test('sin resumen conocido devuelve null', ({ assert }) => {
    assert.isNull(resumenDeTests('ran 5 things'))
  })

  test('la fila de check nombra el paso de tests con su conteo, venga de Jest o de Japa', ({
    assert,
  }) => {
    const jest = filaDeCheck({ codigo: 0, salida: CORRIDA('Tests:       4 passed, 4 total') })
    assert.deepEqual(jest, { estado: ESTADO.PASA, detalle: 'lint · tests 4/4' })
    const japa = filaDeCheck({ codigo: 0, salida: CORRIDA('Tests  4 passed (4)') })
    assert.deepEqual(japa, { estado: ESTADO.PASA, detalle: 'lint · tests 4/4' })
  })
})
