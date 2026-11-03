// Las 11 reglas del perfil «Sonar way» que más disparan en proyectos Node/TS, con el id de Sonar de cada una.
// Las corre el pre-commit en modo «no empeorar» (src/sonar_check.mjs); a mano: npm run lint:sonar
import sonarjs from 'eslint-plugin-sonarjs'
import tseslint from 'typescript-eslint'
import unicorn from 'eslint-plugin-unicorn'

const MAXIMO_DE_SCRIPTS_DE_HOOKS = 30

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.d.ts',
    ],
  },
  {
    files: ['**/*.ts', '**/*.mjs'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: {
          allowDefaultProject: [],
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: MAXIMO_DE_SCRIPTS_DE_HOOKS,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { sonarjs, '@typescript-eslint': tseslint.plugin, unicorn },
    rules: {
      'sonarjs/cognitive-complexity': ['error', 15], // S3776
      'sonarjs/no-nested-conditional': 'error', // S3358
      'sonarjs/no-alphabetical-sort': 'error', // S2871
      'sonarjs/no-nested-template-literals': 'error', // S4624
      'sonarjs/no-invariant-returns': 'error', // S3516
      '@typescript-eslint/prefer-readonly': 'error', // S2933
      '@typescript-eslint/no-empty-function': [
        'error',
        {
          allow: [
            'arrowFunctions',
            'constructors',
            'private-constructors',
            'protected-constructors',
          ],
        },
      ], // S1186
      '@typescript-eslint/prefer-optional-chain': 'error', // S6582
      'unicorn/no-array-callback-reference': 'error', // S7727
      'unicorn/consistent-function-scoping': 'error', // S7721
      'unicorn/prefer-top-level-await': 'error', // S7785
    },
  },
]
