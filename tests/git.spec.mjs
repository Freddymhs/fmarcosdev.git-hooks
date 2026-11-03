import { test } from './japa.mjs'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ramaActual, diffStaged, lineasAgregadas, lineasBorradas } from '../src/git.mjs'

test.group('hooks · git · el diff staged', () => {
  test('numera las líneas agregadas por archivo y por hunk, sin el encabezado ni lo borrado', ({
    assert,
  }) => {
    const diff = [
      'diff --git a/config/mail.ts b/config/mail.ts',
      'index 1111111..2222222 100644',
      '--- a/config/mail.ts',
      '+++ b/config/mail.ts',
      '@@ -10,0 +11,2 @@ export default',
      '+const a = 1',
      '+const b = 2',
      '@@ -20 +22 @@',
      '-viejo',
      '+nuevo',
      'diff --git a/docs/nuevo.md b/docs/nuevo.md',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/docs/nuevo.md',
      '@@ -0,0 +1 @@',
      '+++ empieza con dos más',
      '\\ No newline at end of file',
      '',
    ].join('\n')
    assert.deepEqual(lineasAgregadas(diff), [
      { ruta: 'config/mail.ts', numero: 11, texto: 'const a = 1' },
      { ruta: 'config/mail.ts', numero: 12, texto: 'const b = 2' },
      { ruta: 'config/mail.ts', numero: 22, texto: 'nuevo' },
      { ruta: 'docs/nuevo.md', numero: 1, texto: '++ empieza con dos más' },
    ])
  })

  test('numera las líneas borradas desde el lado viejo', ({ assert }) => {
    const diff = [
      'diff --git a/start/env.ts b/start/env.ts',
      'index 1111111..2222222 100644',
      '--- a/start/env.ts',
      '+++ b/start/env.ts',
      '@@ -30,2 +30 @@',
      '-  PORT: Env.schema.number(),',
      '--- empieza con dos menos',
      '+  PORT: Env.schema.number.optional(),',
      '',
    ].join('\n')
    assert.deepEqual(lineasBorradas(diff), [
      { ruta: 'start/env.ts', numero: 30, texto: '  PORT: Env.schema.number(),' },
      { ruta: 'start/env.ts', numero: 31, texto: '-- empieza con dos menos' },
    ])
  })

  test('un archivo borrado entero aporta sus líneas con la ruta vieja', ({ assert }) => {
    const diff = [
      'diff --git a/app/x.ts b/app/x.ts',
      'deleted file mode 100644',
      'index 1111111..0000000',
      '--- a/app/x.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-uno',
      '-dos',
      '',
    ].join('\n')
    assert.deepEqual(lineasBorradas(diff), [
      { ruta: 'app/x.ts', numero: 1, texto: 'uno' },
      { ruta: 'app/x.ts', numero: 2, texto: 'dos' },
    ])
    assert.deepEqual(lineasAgregadas(diff), [])
  })

  test('una ruta con espacios sale sin el TAB que git le pone al final', ({ assert }) => {
    const ruta = 'app/dir con espacio/conexión.ts'
    const diff = [
      `diff --git a/${ruta} b/${ruta}`,
      'index 1111111..2222222 100644',
      `--- a/${ruta}\t`,
      `+++ b/${ruta}\t`,
      '@@ -1 +1 @@',
      '-viejo',
      '+nuevo',
      '',
    ].join('\n')
    assert.deepEqual(lineasAgregadas(diff), [{ ruta, numero: 1, texto: 'nuevo' }])
    assert.deepEqual(lineasBorradas(diff), [{ ruta, numero: 1, texto: 'viejo' }])
  })

  test('un diff binario no aporta líneas', ({ assert }) => {
    const diff = [
      'diff --git a/logo.png b/logo.png',
      'Binary files a/logo.png and b/logo.png differ',
      '',
    ].join('\n')
    assert.deepEqual(lineasAgregadas(diff), [])
  })
})

test.group('hooks · git · diffStaged', (group) => {
  const original = process.cwd()
  const repo = mkdtempSync(join(tmpdir(), 'hooks-git-'))
  const enRepo = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })

  group.setup(() => {
    enRepo('init', '-q')
    writeFileSync(join(repo, 'modificado.ts'), 'uno\n')
    writeFileSync(join(repo, 'borrado.ts'), 'dos\n')
    writeFileSync(join(repo, 'renombrado.ts'), 'cuatro\n')
    enRepo('add', '.')
    enRepo('-c', 'user.email=prueba@local', '-c', 'user.name=prueba', 'commit', '-q', '-m', 'base')
    writeFileSync(join(repo, 'modificado.ts'), 'uno cambiado\n')
    writeFileSync(join(repo, 'nuevo.ts'), 'tres\n')
    enRepo('rm', '-q', 'borrado.ts')
    enRepo('mv', 'renombrado.ts', 'con-otro-nombre.ts')
    enRepo('add', '.')
    process.chdir(repo)
    return () => {
      process.chdir(original)
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('el filtro decide qué archivos trae el diff, y un renombre es un borrado más un agregado', ({
    assert,
  }) => {
    const rutasDe = (diff) => [...diff.matchAll(/^diff --git a\/(\S+)/gm)].map(([, ruta]) => ruta)
    assert.deepEqual(rutasDe(diffStaged('ACMR')), [
      'con-otro-nombre.ts',
      'modificado.ts',
      'nuevo.ts',
    ])
    assert.deepEqual(rutasDe(diffStaged('MD')), ['borrado.ts', 'modificado.ts', 'renombrado.ts'])
  })

  test('git de verdad pone el TAB en una ruta con espacios, y se saca', ({ assert }) => {
    const ruta = 'dir con espacio/conexión.ts'
    mkdirSync(join(repo, 'dir con espacio'), { recursive: true })
    writeFileSync(join(repo, ruta), 'cinco\n')
    enRepo('add', '.')
    const conEspacio = lineasAgregadas(diffStaged('A')).filter((linea) =>
      linea.ruta.startsWith('dir')
    )
    enRepo('rm', '-q', '--cached', ruta)
    assert.deepEqual(conEspacio, [{ ruta, numero: 1, texto: 'cinco' }])
  })

  test('sale sin contexto, así cada línea + es agregada', ({ assert }) => {
    assert.deepEqual(lineasAgregadas(diffStaged('ACMR')), [
      { ruta: 'con-otro-nombre.ts', numero: 1, texto: 'cuatro' },
      { ruta: 'modificado.ts', numero: 1, texto: 'uno cambiado' },
      { ruta: 'nuevo.ts', numero: 1, texto: 'tres' },
    ])
  })
})

test.group('hooks · git · ramaActual', (group) => {
  const original = process.cwd()
  const repo = mkdtempSync(join(tmpdir(), 'hooks-rama-'))
  const enRepo = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })

  group.setup(() => {
    enRepo('init', '-q', '-b', 'main')
    process.chdir(repo)
    return () => {
      process.chdir(original)
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('en un repo recién creado, antes del primer commit, devuelve la rama', ({ assert }) => {
    assert.equal(ramaActual(), 'main')
  })

  test('con commits sigue devolviendo la rama', ({ assert }) => {
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    enRepo('add', '.')
    enRepo('-c', 'user.email=prueba@local', '-c', 'user.name=prueba', 'commit', '-q', '-m', 'base')
    enRepo('checkout', '-q', '-b', 'feature/3_x')
    assert.equal(ramaActual(), 'feature/3_x')
  })
})
