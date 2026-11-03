# Decisiones de diseño

Cada regla de los hooks existe por una decisión tomada en uso real, no por gusto. Van acá para
que nadie las relitigue en el momento de un commit frenado: si una parece equivocada, se discute
con este archivo abierto y se cambia la constante, no se salta el hook.

## D1 · El commit es tuyo, el push es del equipo

Al commitear, el hook frena solo lo que arruina el historial y cuesta rehacer: un secreto, un
`#número` de otra tarea. Todo lo demás **avisa**, para que quince commits chicos no se frenen por
calidad. Al pushear, lo que avisó **frena** (salvo `wip`, D3): nada sale de la máquina sin pasar
`npm run check`. La investigación previa (pre-commit.com, commitlint, lefthook, trunk) marcó la
causa número uno de `--no-verify`: hooks de commit que bloquean estados intermedios legítimos.

## D2 · Frena solo lo que el equipo ya cumple o lo que rompe algo; lo demás avisa

Un hook que frena el commit bueno de un compañero enseña a usar `--no-verify`, y ahí deja de
proteger. Por eso el `#task` que falta y el nombre de la rama avisan; si el equipo adopta la
convención, pasarlos a «frena» es cambiar una constante.

## D3 · `wip` es legítimo, y nunca frena

En el `commit-msg`, un asunto `wip…` o sin tipo avisa y pasa. En el `pre-push`, un commit así en
la rama avisa con «squasheá antes del PR». Se evaluó frenar y se descartó: demasiado restrictivo
para avances chicos. `fixup!` y `squash!` están exentos.

## D4 · El mensaje, por etapa

En el `commit-msg` frena una sola cosa: un `#<número>` que no es la tarea de la rama
(`feature/<id>_…`), porque el tracker vincula todo `#número` y al completar el PR puede cerrar
un ítem ajeno; corregirlo después cuesta un `rebase -i`. Avisan: el asunto sin tipo convencional
(`feat|fix|refactor|test|docs|chore|perf|style|build|ci`), el `#task` propio que falta y más de
100 caracteres. Exentos siempre, porque los escriben git o el tracker: `Merge`, `Merged PR`,
`Revert`, `fixup!`, `squash!`.

## D5 · Secretos: en el diff, no en el archivo

Frena si se stagea `.env`, `.env.*` (salvo los `.example`) o `.npmrc`, o si una línea **agregada**
de cualquier archivo, `.md` incluidos, trae un valor con forma de secreto: la asignación de un
`_password` o un `_authToken` de `.npmrc`, el encabezado de una llave privada PEM, los prefijos
de llave de API de Anthropic o Copilot, o
`(key|token|secret|password)['"]?\s*[=:]\s*['"][^'"\s]{12,}`. Las formas exactas viven en
`src/secretos.mjs`; no se escriben acá porque este mismo archivo pasa por el hook. Se mira el
diff: `env.get('DB_PASSWORD')`
y `APP_KEY: Env.schema.string()` pasan; una línea vieja que calza solo frena si alguien la vuelve
a agregar.

## D6 · Variables de entorno: solo las nuevas

Toma las claves **agregadas** al esquema (`hooks.variables.esquema`, por defecto `start/env.ts`).
Una **obligatoria** (sin `.optional()`) exige `^CLAVE=` en `.env.example` y, si el repo declara un
registro (`hooks.variables.registro`), su entrada ahí: avisa al commitear y frena al pushear. Una
**opcional** avisa y deja pasar. `NODE_ENV` se exceptúa: la pone el despliegue. Una variable solo
local se declara `.optional()`.

## D7 · La versión sube sola, un patch, en el pre-commit

Solo en los repos que lo exigen (`hooks.exigeVersion`). Compara `package.json` con la rama base:
si ya es mayor no toca nada; si es igual, `npm version patch --no-git-tag-version` y agrega
`package.json` y el lock **al mismo commit**; la fila lo dice (`⬆ versión 1.8.9 → 1.8.10`). Minor
y major los pone la persona antes de commitear y el hook los respeta. **Es la única excepción,
declarada, a «ningún hook modifica archivos»**: nada más escribe, ni `eslint --fix`.

## D8 · Al pushear, la versión y el lock son una red

Frena si la versión no es mayor que la de la base o no coincide con la raíz del lock, solo si el
repo lo exige; es la red de D7 por si el pre-commit se saltó, y el remedio es un comando. Avisa si
la rama no lleva número de task y si está atrás de la base según el último fetch: **el hook no
hace fetch**, no suma red al push.

## D9 · Cambios sin commitear en archivos trackeados frenan el push; un archivo nuevo sin agregar avisa

Lo que `check` prueba tiene que ser lo que se sube. Un script a mano que la persona no quiere
commitear no la obliga a borrar nada: solo se nombra en la fila.

## D10 · El pre-push corre `npm run check` del repo

`check` es lo que el repo defina (típicamente typecheck, lint, Sonar y tests, encadenados con
`&&`). Si no está lo que necesitan los tests (Redis, Docker), se saltan con un aviso de una línea y
el resto frena igual; si el runner no llega a imprimir su resumen, también avisa, nunca en
silencio. Qué necesitan los tests **se deduce** del `package.json` (`redis`, `ioredis` o
`@adonisjs/redis` → Redis; `testcontainers` → Docker).

## D11 · Lint y Sonar en «no empeorar»

Un repo con deuda de lint no puede exigir cero: ningún push pasaría. El push frena solo si el lint
de los archivos que la rama toca tiene **más** errores que esos mismos archivos en la base (el
*hold-the-line* de trunk). Las reglas de Sonar (`eslint.sonar.config.js`, si existe) avisan en el
commit midiendo contra `HEAD` y frenan en el push dentro de `check`.

## D12 · Cobertura del código nuevo: avisa al commitear, frena al pushear

Al commitear, un archivo nuevo que calce con `hooks.cobertura.nuevos` sin ningún spec que lo
importe avisa. Al pushear, frenan las líneas que la rama cambió sin cubrir por los tests (c8 sobre
la suite), no el % total: borrar código probado o sumar una constante no frena. Si no se puede
medir —tests saltados por falta de infraestructura—, avisa.

## D13 · Sin typecheck en el pre-commit

Estaba duplicado con `check` al pushear, que lo corre primero. Ahorra 4-6 s por commit.

## D14 · Corre todo y resume; no frena al primero

Con todos los chequeos del commit bajo 1 s salvo Sonar, la persona arregla todo de una vez.
`check` sigue con `&&`: eso lo decide el repo.

## D15 · La salida: una fila por chequeo, el remedio y la guía debajo del veredicto

Orden fijo: **dónde** (`husky · <etapa> · <repo> · <contexto>`) · **qué pasó** (una fila por
chequeo: `✔` pasó · `✖` frena · `⚠` avisa · `–` saltado con su motivo · `⬆` versión subida; los
que pasan traen una cifra) · **veredicto** (`✖ 1 problema · ⚠ 1 aviso · 2.9 s` frenó; `✔ ⚠ 2
avisos · 1.8 s` salió con avisos; `✔ 1.8 s` limpio) · **qué hago**, solo si algo falló o avisó:
una línea por chequeo con el remedio corto y el nombre de su guía, y debajo la URL de cada guía
nombrada, una vez. Exit codes: 0 limpio o solo avisos · 1 encontró algo · 2 el hook no pudo
correr (y lo dice). La prueba de la foto: alguien que no conoce los hooks mira la salida y dice
qué falló y qué haría.

## D16 · Sin salto por chequeo: una etapa se salta con `--no-verify` de git

Sin `HOOKS_SKIP` ni variables propias: nadie las recuerda y es un lío mantenerlas.
`git commit --no-verify` salta el commit y el mensaje (git no los separa); `git push --no-verify`
salta el push. Consecuencia aceptada: secretos y cobertura también se saltan así, porque ningún
hook local puede impedirlo; lo que nadie puede saltar vive en el pipeline.

## D17 · Agnóstico: se monta igual en cualquier repo

Los scripts no nombran ningún proyecto. Lo que cambia por repo es **dato** en `package.json`
(`hooks.*`) o **se deduce** (qué necesitan los tests, si existe la config de Sonar, si existe el
script `check`). Lo que no aplica en un repo sale `–` con su motivo, nunca en silencio.
