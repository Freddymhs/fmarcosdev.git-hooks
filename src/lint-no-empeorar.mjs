import { correrComoScript } from './sonar_check.mjs'

await correrComoScript({
  script: 'lint-no-empeorar',
  config: 'eslint.config.js',
  que: 'errores de lint',
  aMano: 'npm run lint',
})
