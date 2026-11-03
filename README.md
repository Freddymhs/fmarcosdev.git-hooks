# @fmarcosdev/git-hooks

Hooks de git para repos Node, sin dependencias: **el commit avisa, el push frena.** Lo que se
revisaba a mano antes de cada PR corre solo, en local, y la salida dice qué pasó y qué hacer.

```
husky · pre-push · api.resume · feature/12_bandeja → origin

✔ limpio       sin cambios sin commitear
✔ commits      3 commits con tipo
⚠ #task        1 de 3 sin #12
– variables    saltado: start/env.ts sin cambios
✔ versión      1.4.1 > main 1.4.0
✔ rama         12
⚠ atraso       2 commits atrás de origin/main
✔ check        typecheck · lint · tests 48/48
✔ cobertura    17 líneas nuevas, todas cubiertas

✔ ⚠ 2 avisos · 21.3 s
  #task   ejemplo: fix(#12): arreglo del filtro de fechas   guía: mensaje
  atraso  git rebase origin/main antes del PR               índice
  índice: https://github.com/Freddymhs/fmarcosdev.git-hooks/blob/main/docs/guia.md
```

## Instalar en un proyecto

```bash
npm i -D @fmarcosdev/git-hooks husky
npx git-hooks init                                  # .husky/commit-msg, pre-commit, pre-push
npm pkg set scripts.prepare=husky && npm run prepare
```

Y en `package.json`, solo lo que cambia por proyecto:

```json
"hooks": {
  "ramaBase": "origin/main",
  "exigeVersion": false,
  "tasks": true,
  "apagados": ["cobertura"]
}
```

Prendé solo lo que ese repo usa: lo demás va en `apagados` y sale `–`. El hook no sabe qué runner de tests usás ni cómo se lintea: corre `npm test` y
`npm run check` del repo, y deduce de `package.json` qué necesitan los tests (Redis, Docker).
Lo que no aplica en un repo sale `–` con su motivo.

## Qué revisa

| etapa | chequeo | | por qué |
|---|---|---|---|
| commit | secreto en una línea agregada, o `.env`/`.npmrc` staged | 🔴 frena | entra al historial y no se deshace |
| commit | versión igual a la de la base, si el repo la exige | ⬆ sube el patch sola | «siempre se nos olvida»; única escritura de un hook |
| commit | Sonar empeora contra `HEAD` (si hay `eslint.sonar.config.js`) | 🟡 avisa | un avance a medias puede superar la complejidad; frena al pushear |
| commit | variable nueva en el esquema sin `.env.example` | 🟡 avisa | obligatoria: frena al pushear · opcional: puede ser local |
| commit | archivo nuevo sin un spec que lo importe | 🟡 avisa | al pushear frenan sus líneas sin cubrir |
| mensaje | `#<número>` de **otra** task | 🔴 frena | el tracker lo vincula y al completar el PR cierra ese ítem |
| mensaje | sin tipo convencional, o `wip` · sin `#task` · más de 100 caracteres | 🟡 avisa | el avance chico es libre; al pushear vuelve a avisar |
| push | archivos **trackeados** con cambios sin commitear | 🔴 frena | lo que se prueba no es lo que se sube |
| push | algún commit de la rama `wip` o sin tipo | 🟡 avisa | squasheá antes del PR |
| push | variable **obligatoria** nueva sin `.env.example` o sin registro | 🔴 frena | en el ambiente llega vacía y el servicio no arranca |
| push | versión no mayor que la base, o el lock no coincide | 🔴 frena | red por si se saltó el pre-commit; el arreglo es un comando |
| push | `npm run check` | 🔴 frena | tests sin Redis/Docker se saltan con aviso; lint en «no empeorar» |
| push | líneas nuevas de la rama sin cubrir por los tests | 🔴 frena | no el % total: borrar código probado no frena |
| push | rama sin número de task · rama atrasada | 🟡 avisa | el atraso no rompe todavía; el hook no hace fetch |

Sin salto por chequeo: `git commit --no-verify` salta el commit y el mensaje, `git push --no-verify`
el push. Exit codes: 0 limpio o solo avisos · 1 encontró algo · 2 el hook no pudo correr.

## Configuración (`package.json` → `hooks`)

| clave | default | qué hace |
|---|---|---|
| `ramaBase` | `origin/main` | contra qué se mide la rama (atraso, versión, lint, cobertura) |
| `exigeVersion` | `false` | sube el patch en el commit y frena el push si no es mayor que la base |
| `tasks` | `true` | las ramas llevan `feature/<id>_…` y los mensajes `#<id>`; en `false` se salta |
| `guiaUrl` | `null` | base de la guía que aparece bajo el veredicto; sin ella no hay URLs |
| `apagados` | `[]` | chequeos que este repo no usa: `["cobertura", "sonar", "version"]`; salen `– apagado` |
| `variables.esquema` | `start/env.ts` | archivo donde se declaran las variables (`CLAVE: Env.schema.…`) |
| `variables.ejemplo` | `.env.example` | donde tiene que estar cada obligatoria |
| `variables.registro` | `null` | `{ "mapeo": "…", "interfaces": "…" }` si un registro (p. ej. Consul) también la exige |
| `cobertura.incluye` | `src/**` | lo que mide c8 al pushear |
| `cobertura.nuevos` | `^src/.+\.(?:ts\|js\|mjs)$` | qué archivo nuevo necesita un spec al commitear |

Opcionales del repo: `eslint.sonar.config.js` (las reglas de Sonar; sin él se salta),
`npm run check` (sin él el push lo dice y sigue), `c8` en `devDependencies` (sin él la cobertura
avisa que no pudo medir).

## Por qué así

Cada regla tiene su decisión en [`docs/decisiones.md`](docs/decisiones.md); la guía de cada
chequeo y cómo salir, en [`docs/guia.md`](docs/guia.md); de dónde viene, en
[`docs/origen.md`](docs/origen.md).

## Desarrollo

```bash
npm test            # node --test, sin red: repos temporales en /tmp
npm run check       # lint · sonar · tests (es el pre-push de este mismo repo)
```

Node ≥ 22. Publica `semantic-release` desde `main` con commits convencionales.
