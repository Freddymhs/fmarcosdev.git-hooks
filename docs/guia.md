# Guía — qué revisa cada hook y cómo se sale

Índice rápido, una línea por chequeo. Para saltar una etapa entera: `git commit --no-verify`
(salta `pre-commit` y `commit-msg`) o `git push --no-verify`. No hay otro salto.

| etapa | chequeo | qué mira | cuando falla |
|---|---|---|---|
| commit | secretos | `.env`/`.npmrc` staged, o un valor con forma de secreto en una línea agregada | 🔴 frena |
| commit | sonar | las reglas de `eslint.sonar.config.js` sobre los `.ts` staged, contra `HEAD` | 🟡 avisa |
| commit | variables | claves nuevas en el esquema sin `.env.example` (o sin registro) | 🟡 avisa |
| commit | cobertura | archivo nuevo sin un spec que lo importe | 🟡 avisa |
| commit | versión | igual a la base y el repo la exige | ⬆ la sube un patch |
| mensaje | #ajeno | un `#número` que no es la tarea de la rama | 🔴 frena |
| mensaje | tipo · #task · largo | sin tipo convencional o `wip` · sin `#task` propio · más de 100 caracteres | 🟡 avisa |
| push | limpio | archivos trackeados con cambios sin commitear | 🔴 frena |
| push | commits · #task | commits `wip` o sin tipo · commits sin el `#task` | 🟡 avisa |
| push | variables | obligatoria nueva sin `.env.example` o sin registro | 🔴 frena |
| push | versión | no mayor que la base, o el lock no coincide | 🔴 frena |
| push | rama · atraso | rama sin número de task · atrás de la base (sin fetch) | 🟡 avisa |
| push | check | `npm run check` del repo | 🔴 frena |
| push | cobertura | líneas nuevas de la rama sin cubrir por los tests | 🔴 frena |

## Mensaje y rama

El asunto lleva un tipo convencional: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`,
`style`, `build`, `ci`, con alcance opcional: `fix(#1234): arreglo del filtro de fechas`. La rama
lleva el número de tarea: `feature/<task>_<descripción>` (también `fix/`, `hotfix/`, `chore/`).
Un `#número` distinto al de la rama frena el commit porque el tracker lo vincula y al completar
el PR puede cerrar ese ítem. Para nombrar otra tarea sin `#`: «HU 1234» o «PR 1234». `wip` vale
mientras trabajás; antes del PR, `git rebase -i <base>` y un commit con tipo y `#task`. En repos
sin tracker: `"hooks": { "tasks": false }` y los chequeos de task se saltan.

## Reglas de Sonar

Corren si existe `eslint.sonar.config.js` en la raíz del repo (las 11 reglas del perfil «Sonar
way» que más disparan: complejidad cognitiva, condicionales anidados, template literals
anidados, `readonly`, funciones vacías, optional chain, scoping de funciones, top-level await,
sort alfabético, retornos invariantes, callbacks por referencia). En el commit se mide contra
`HEAD` y avisa; en el push, dentro de `check` (`npm run lint:sonar`), frena si la rama **empeora**
los archivos que toca contra la base. A mano: `npm run lint:sonar`. El lint del equipo
(`eslint.config.js`) sigue la misma regla de «no empeorar»: `node_modules/.bin/git-hooks` no lo
corre; lo corre `check` vía `lint-no-empeorar.mjs --base <rama>`.

## Variables de entorno

Se miran solo las claves **agregadas** al esquema (`hooks.variables.esquema`, por defecto
`start/env.ts`, una por línea `CLAVE: Env.schema.…`). Obligatoria (sin `.optional()`): tiene que
estar en `.env.example` como `CLAVE=`; si el repo declara un registro
(`hooks.variables.registro`: `{ "mapeo": "consul/consul.ts", "interfaces": "consul/interfaces.ts" }`),
también ahí. Falta algo: avisa al commitear, frena al pushear. Opcional: avisa si no está en el
registro, y pasa. `NODE_ENV` no cuenta. Si es solo local, declarala `.optional()`.

## Cobertura

Al commitear: un archivo nuevo que calce con `hooks.cobertura.nuevos` (por defecto
`^src/.+\.(?:ts|js|mjs)$`) sin ningún spec en `tests/` que lo importe, avisa. Al pushear: `check`
corre los tests bajo c8 (`hooks.cobertura.incluye`, por defecto `src/**`) y frenan las líneas que
la rama agregó o cambió y ningún test ejecutó; no cuenta el % total. Para ver en local qué líneas
faltan: `npm run test:si-hay-infra` deja el reporte en `.git/hooks-cobertura/`. Si los tests no
pudieron correr (sin Redis, sin Docker), avisa en vez de frenar. Fuera del conteo: archivos
`.d.ts` y `.dto.ts`.
