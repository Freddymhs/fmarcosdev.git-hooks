import nodeAssert from 'node:assert/strict'
import { after, before, describe, test as nodeTest } from 'node:test'

const assert = Object.freeze({
  equal: nodeAssert.equal,
  notEqual: nodeAssert.notEqual,
  deepEqual: nodeAssert.deepEqual,
  match: nodeAssert.match,
  isTrue: (valor, mensaje) => nodeAssert.equal(valor, true, mensaje),
  isFalse: (valor, mensaje) => nodeAssert.equal(valor, false, mensaje),
  isNull: (valor, mensaje) => nodeAssert.equal(valor, null, mensaje),
  isUndefined: (valor, mensaje) => nodeAssert.equal(valor, undefined, mensaje),
  isString: (valor, mensaje) => nodeAssert.equal(typeof valor, 'string', mensaje),
  lengthOf: (coleccion, largo, mensaje) => nodeAssert.equal(coleccion.length, largo, mensaje),
  include: (conjunto, parte, mensaje) =>
    nodeAssert.ok(
      conjunto.includes(parte),
      mensaje ?? `esperaba que incluyera ${JSON.stringify(parte)}:\n${conjunto}`
    ),
  notInclude: (conjunto, parte, mensaje) =>
    nodeAssert.ok(
      !conjunto.includes(parte),
      mensaje ?? `no esperaba ${JSON.stringify(parte)}:\n${conjunto}`
    ),
  deepInclude: (coleccion, elemento, mensaje) =>
    nodeAssert.ok(
      Array.isArray(coleccion)
        ? coleccion.some((uno) => sonIguales(uno, elemento))
        : Object.entries(elemento).every(([clave, valor]) => sonIguales(coleccion[clave], valor)),
      mensaje ?? `esperaba que incluyera ${JSON.stringify(elemento)}:\n${JSON.stringify(coleccion)}`
    ),
})

function sonIguales(uno, otro) {
  try {
    nodeAssert.deepEqual(uno, otro)
    return true
  } catch {
    return false
  }
}

function grupo() {
  const limpiezas = []
  after(async () => {
    for (const limpiar of limpiezas.reverse()) await limpiar()
  })
  return Object.freeze({
    setup(preparar) {
      before(async () => {
        const limpiar = await preparar()
        if (typeof limpiar === 'function') limpiezas.push(limpiar)
      })
    },
  })
}

const SIN_TOPE = Object.freeze({
  timeout() {
    return SIN_TOPE
  },
})

export function test(nombre, cuerpo) {
  nodeTest(nombre, () => cuerpo({ assert }))
  return SIN_TOPE
}

test.group = (nombre, cuerpo) => describe(nombre, () => cuerpo(grupo()))
