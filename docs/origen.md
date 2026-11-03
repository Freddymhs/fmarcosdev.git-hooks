# Origen

Estos hooks nacieron en un proyecto de microservicios Node/TypeScript para un cliente del
Estado, entre octubre y noviembre de 2026, como la «fase de husky extras» de un backend con
nueve repos, revisión de arquitectura por PR, SonarQube y Azure DevOps. Allá se montaron como
copia dentro de cada repo; acá son un paquete, que es lo que aquella fase dejó anotado como
«futura extracción»: corregir un hook en nueve repos son nueve PR.

Lo que se trajo tal cual: los scripts, sus 120 tests y las decisiones de diseño
([`decisiones.md`](decisiones.md)). Lo que se sacó por ser de aquel cliente: el chequeo que
protegía la plantilla de código del cliente, y el registro de variables en Consul (acá es una
perilla opcional, `hooks.variables.registro`). Lo que pasó a ser configuración: la rama base,
si el repo exige subir la versión, si usa números de task, la URL de la guía y qué carpetas
cuenta la cobertura.

Los tests se escribieron con Japa (el runner de AdonisJS). Acá corren con `node:test` a través
de [`tests/japa.mjs`](../tests/japa.mjs), un adaptador de 60 líneas que conserva la API usada
(`test.group`, `group.setup` con limpieza, `assert.include` y compañía), así los specs quedaron
intactos salvo el import.
