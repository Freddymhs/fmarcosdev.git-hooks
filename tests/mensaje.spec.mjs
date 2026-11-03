import { test } from './japa.mjs'
import { SALIDA, ejecutar } from '../src/salida.mjs'
import { asuntoDe, chequeosDelMensaje, taskDeLaRama } from '../src/mensaje.mjs'

const RAMA = 'feature/27005_husky_extras'

async function revisar(mensaje, rama = RAMA) {
  const escrito = []
  const codigo = await ejecutar({
    etapa: 'commit-msg',
    repo: 'api.bff',
    chequeos: () => chequeosDelMensaje({ mensaje, rama }),
    entorno: {},
    color: false,
    escribir: (texto) => escrito.push(texto),
  })
  return { codigo, lineas: escrito.join('').split('\n') }
}

function fila(lineas, nombre) {
  return lineas.find((linea) => linea.slice(2).startsWith(`${nombre} `))
}

test.group('hooks · mensaje · la task de la rama', () => {
  test('sale del número después del prefijo', ({ assert }) => {
    assert.equal(taskDeLaRama('feature/27005_husky_extras'), '27005')
    assert.equal(taskDeLaRama('fix/123-arreglo'), '123')
    assert.equal(taskDeLaRama('hotfix/42_x'), '42')
    assert.equal(taskDeLaRama('chore/7_x'), '7')
  })

  test('sin número, con prefijo HU o fuera de una rama, no hay task', ({ assert }) => {
    assert.isNull(taskDeLaRama('feature/arreglos'))
    assert.isNull(taskDeLaRama('feature/HU18134_x'))
    assert.isNull(taskDeLaRama('develop'))
    assert.isNull(taskDeLaRama('HEAD'))
    assert.isNull(taskDeLaRama(null))
  })
})

test.group('hooks · mensaje · el asunto', () => {
  test('salta los comentarios de git y corta en la tijera', ({ assert }) => {
    const mensaje = [
      '',
      '# Please enter the commit message',
      'fix(#27005): arreglo cosas',
      '',
      'cuerpo',
      '# ------------------------ >8 ------------------------',
      '+ código con #1234',
    ].join('\n')
    assert.equal(asuntoDe(mensaje), 'fix(#27005): arreglo cosas')
  })
})

test.group('hooks · mensaje · commit-msg', () => {
  test('el mensaje completo pasa limpio', async ({ assert }) => {
    const { codigo, lineas } = await revisar('fix(#27005): arreglo cosas')
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.equal(lineas[0], 'husky · commit-msg · api.bff')
    assert.equal(fila(lineas, '#ajeno'), '✔ #ajeno       ningún # de otra task')
    assert.equal(fila(lineas, 'tipo'), '✔ tipo         fix')
    assert.equal(fila(lineas, '#task'), '✔ #task        #27005')
    assert.equal(fila(lineas, 'largo'), '✔ largo        26 caracteres')
    assert.isUndefined(lineas.find((linea) => linea.includes('guía:')))
  })

  test('wip pasa con aviso y pide squashear', async ({ assert }) => {
    const { codigo, lineas } = await revisar('wip cosas')
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.equal(fila(lineas, 'tipo'), '⚠ tipo         «wip cosas»')
    assert.match(lineas.join('\n'), /^ {2}tipo +.*squasheá antes del PR +guía: mensaje$/m)
  })

  test('sin tipo pasa con aviso y lista los tipos', async ({ assert }) => {
    const { codigo, lineas } = await revisar('arreglo cosas')
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.equal(fila(lineas, 'tipo'), '⚠ tipo         «arreglo cosas»')
    assert.match(lineas.join('\n'), /^ {2}tipo +feat · fix · refactor .* · ci +guía: mensaje$/m)
  })

  test('los tipos válidos, con alcance y con !', async ({ assert }) => {
    for (const mensaje of ['feat: x', 'refactor(api)!: x', 'ci!: x', 'perf(#27005): x']) {
      const { lineas } = await revisar(mensaje)
      assert.match(fila(lineas, 'tipo'), /^✔ /, mensaje)
    }
    for (const mensaje of ['Feat: x', 'feat:x', 'feature: x', 'feat (x): y']) {
      const { lineas } = await revisar(mensaje)
      assert.match(fila(lineas, 'tipo'), /^⚠ /, mensaje)
    }
  })

  test('un # de otra task frena el commit, en el asunto o en el cuerpo', async ({ assert }) => {
    const enAsunto = await revisar('fix(#9999): arreglo cosas')
    assert.equal(enAsunto.codigo, SALIDA.ENCONTRO)
    assert.equal(
      fila(enAsunto.lineas, '#ajeno'),
      '✖ #ajeno       #9999 no es la task de la rama (27005)'
    )
    assert.match(
      enAsunto.lineas.join('\n'),
      /^ {2}#ajeno +sin #: otra task «HU 9999» o un PR «PR 9999» +guía: mensaje$/m
    )
    const enCuerpo = await revisar('fix(#27005): x\n\n- entra en la HU #24434 y #8888')
    assert.equal(enCuerpo.codigo, SALIDA.ENCONTRO)
    assert.match(fila(enCuerpo.lineas, '#ajeno'), /#24434 · #8888 no son la task de la rama/)
  })

  test('los # de un comentario o debajo de la tijera no cuentan', async ({ assert }) => {
    const mensaje = [
      'fix(#27005): x',
      '# viene de #1111',
      '# ------------------------ >8 ------------------------',
      '+ diff con #2222',
    ].join('\n')
    const { codigo } = await revisar(mensaje)
    assert.equal(codigo, SALIDA.LIMPIO)
  })

  test('una línea del cuerpo que empieza con #número no es comentario: git la guarda con -m', async ({
    assert,
  }) => {
    const { codigo, lineas } = await revisar('fix(#27005): x\n\n#27006 lo de la otra task')
    assert.equal(codigo, SALIDA.ENCONTRO)
    assert.equal(fila(lineas, '#ajeno'), '✖ #ajeno       #27006 no es la task de la rama (27005)')
    const comentarios = await revisar('fix(#27005): x\n#\n# viene de #1111\n')
    assert.equal(comentarios.codigo, SALIDA.LIMPIO)
  })

  test('un PR con # frena, porque Azure lo vincula, y el remedio dice cómo nombrarlo', async ({
    assert,
  }) => {
    const { codigo, lineas } = await revisar('fix(#27005): como en el PR #5450')
    assert.equal(codigo, SALIDA.ENCONTRO)
    assert.match(
      lineas.join('\n'),
      /^ {2}#ajeno +sin #: otra task «HU 5450» o un PR «PR 5450» +guía/m
    )
  })

  test('un # al final de una URL no es un número de task', async ({ assert }) => {
    const { codigo } = await revisar('fix(#27005): x\n\nver https://wiki.local/pagina/#12')
    assert.equal(codigo, SALIDA.LIMPIO)
  })

  test('un # pegado a una letra, un dígito o un & no es un número de task', async ({ assert }) => {
    const { codigo, lineas } = await revisar('fix(#27005): x\n\nIssue#12 · 3#45 · &#123; · ñ#7')
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.equal(fila(lineas, '#ajeno'), '✔ #ajeno       ningún # de otra task')
    const pegado = await revisar('fix: Issue#27005 x')
    assert.equal(fila(pegado.lineas, '#task'), '⚠ #task        sin #27005')
  })

  test('sin el #task propio avisa con el ejemplo de la task de la rama', async ({ assert }) => {
    const { codigo, lineas } = await revisar('fix: arreglo cosas')
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.equal(fila(lineas, '#task'), '⚠ #task        sin #27005')
    assert.match(
      lineas.join('\n'),
      /^ {2}#task +ejemplo: fix\(#27005\): arreglo del filtro de fechas +guía: mensaje$/m
    )
  })

  test('el asunto de más de 100 caracteres avisa; 100 justos pasan', async ({ assert }) => {
    const prefijo = 'fix(#27005): '
    const justo = prefijo + 'x'.repeat(100 - prefijo.length)
    const largo = `${justo}x`
    assert.equal(fila((await revisar(justo)).lineas, 'largo'), '✔ largo        100 caracteres')
    const { codigo, lineas } = await revisar(largo)
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.equal(fila(lineas, 'largo'), '⚠ largo        101 caracteres, máximo 100')
  })

  test('en una rama sin número, un # avisa en vez de frenar y el #task se salta', async ({
    assert,
  }) => {
    const { codigo, lineas } = await revisar('fix(#9999): x', 'feature/arreglos')
    assert.equal(codigo, SALIDA.LIMPIO)
    assert.match(fila(lineas, '#ajeno'), /^⚠ #ajeno +#9999 y la rama no tiene número de task$/)
    assert.equal(fila(lineas, '#task'), '– #task        la rama no tiene número de task')
  })

  test('los mensajes que escriben git y Azure pasan exentos, aunque traigan otro #', async ({
    assert,
  }) => {
    const mensajes = [
      'Merged PR 5450: feat(#26960): el BFF confirma una muestra',
      "Merge branch 'develop' into feature/27005_husky_extras",
      'Revert "fix(#9999): arreglo cosas"',
      'fixup! fix(#9999): arreglo cosas',
      'squash! wip',
    ]
    for (const mensaje of mensajes) {
      const { codigo, lineas } = await revisar(mensaje)
      assert.equal(codigo, SALIDA.LIMPIO, mensaje)
      assert.match(
        fila(lineas, '#ajeno'),
        /^– #ajeno +exento: lo escribe git o el tracker$/,
        mensaje
      )
      assert.match(fila(lineas, 'tipo'), /^– /, mensaje)
    }
  })

  test('hooks.apagados apaga un chequeo del mensaje por su clave', async ({ assert }) => {
    const escrito = []
    await ejecutar({
      etapa: 'commit-msg',
      repo: 'api.bff',
      chequeos: () => chequeosDelMensaje({ mensaje: 'arreglo', rama: RAMA }),
      entorno: {},
      apagados: ['tipo', 'task'],
      color: false,
      escribir: (texto) => escrito.push(texto),
    })
    const lineas = escrito.join('').split('\n')
    assert.equal(fila(lineas, 'tipo'), '– tipo         apagado en package.json (hooks.apagados)')
    assert.equal(fila(lineas, '#task'), '– #task        apagado en package.json (hooks.apagados)')
  })
})
