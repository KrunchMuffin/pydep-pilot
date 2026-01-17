const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');

module.exports = [
    {
        ignores: ['out/**', 'dist/**', '**/*.d.ts', 'node_modules/**']
    },
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                ecmaVersion: 2020,
                sourceType: 'module'
            }
        },
        plugins: {
            '@typescript-eslint': tseslint
        },
        rules: {
            '@typescript-eslint/naming-convention': [
                'warn',
                {
                    selector: 'variable',
                    format: ['camelCase', 'UPPER_CASE'],
                    filter: {
                        regex: '^I.*$',
                        match: false
                    }
                }
            ],
            'curly': 'warn',
            'eqeqeq': 'warn',
            'no-throw-literal': 'warn',
            'semi': 'warn'
        }
    }
];
