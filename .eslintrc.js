'use strict';

module.exports = {
    root: true,
    'extends': [
        'eslint:recommended',
        'plugin:jest/recommended',
        'plugin:regexp/recommended',
        'plugin:@typescript-eslint/eslint-recommended',
        'plugin:@typescript-eslint/recommended',
    ],
    plugins: [
        'jest',
        'regexp',
        '@typescript-eslint',
        'sort-destructure-keys',
        'eslint-plugin-import-helpers',
        'eslint-plugin-import',
    ],
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 2018,
        sourceType: 'module',
    },
    rules: {
        '@typescript-eslint/array-type': [ 'error', {
            'default': 'generic',
            readonly: 'generic',
        } ],
        '@typescript-eslint/brace-style': [ 'error', '1tbs' ],
        '@typescript-eslint/consistent-type-imports': [ 'error' ],
        '@typescript-eslint/explicit-module-boundary-types': [ 'off' ],
        '@typescript-eslint/indent': [ 'error', 4, {
            SwitchCase: 1,
        } ],
        '@typescript-eslint/member-delimiter-style': [ 'error' ],
        '@typescript-eslint/naming-convention': [ 'error',
            {
                selector: 'default',
                format: [ 'camelCase' ],
                leadingUnderscore: 'allow',
                trailingUnderscore: 'forbid',
            },
            {
                selector: 'class',
                format: [ 'PascalCase' ],
            },
            {
                selector: 'enum',
                format: [ 'PascalCase', 'UPPER_CASE' ],
            },
            {
                selector: 'enumMember',
                format: null,
            },
            {
                selector: 'function',
                format: [ 'camelCase', 'PascalCase' ],
            },
            {
                selector: 'interface',
                format: [ 'PascalCase' ],
            },
            {
                selector: 'method',
                format: [ 'camelCase', 'snake_case', 'UPPER_CASE' ],
                leadingUnderscore: 'allow',
            },
            {
                selector: [ 'objectLiteralProperty', 'objectLiteralMethod' ],
                format: null,
            },
            {
                selector: 'parameter',
                format: [ 'camelCase', 'PascalCase' ],
                leadingUnderscore: 'allow',
            },
            {
                selector: 'property',
                format: null,
            },
            {
                selector: 'typeAlias',
                format: [ 'PascalCase' ],
            },
            {
                selector: 'typeParameter',
                format: [ 'PascalCase', 'UPPER_CASE' ],
            },
            {
                selector: 'variable',
                format: [ 'camelCase', 'PascalCase', 'UPPER_CASE' ],
                leadingUnderscore: 'allow',
            },
        ],
        '@typescript-eslint/no-duplicate-imports': [ 'error' ],
        '@typescript-eslint/no-empty-function': [ 'off' ],
        '@typescript-eslint/no-unused-vars': [ 'error', { ignoreRestSiblings: true } ],
        '@typescript-eslint/no-useless-constructor': [ 'error' ],
        '@typescript-eslint/no-var-requires': [ 'off' ],
        '@typescript-eslint/type-annotation-spacing': 'error',

        // turned off in favor of  @typescript-eslint
        'brace-style': 'off',
        camelcase: 'off',
        indent: 'off',
        'no-unused-vars': 'off',
        'no-use-before-define': 'off',
        'no-useless-constructor': 'off',

        'array-bracket-spacing': [ 'error', 'always' ],
        'arrow-spacing': [ 'error', { before: true, after: true } ],
        'comma-dangle': [ 'error', 'always-multiline' ],
        'comma-spacing': [ 'error' ],
        'comma-style': [ 'error', 'last' ],
        curly: [ 'error', 'all' ],
        'eol-last': 'error',
        eqeqeq: [ 'error', 'allow-null' ],
        'id-match': [ 'error', '^[\\w$]+$' ],
        'key-spacing': [ 'error', {
            beforeColon: false,
            afterColon: true,
        } ],
        'keyword-spacing': 'error',
        'linebreak-style': [ 'error', 'unix' ],
        'lines-around-comment': [ 'error', {
            beforeBlockComment: true,
            allowBlockStart: true,
        } ],
        'max-len': [ 'error', 160, 4 ],
        'no-console': 'error',
        'no-empty': [ 'error', { allowEmptyCatch: true } ],
        'no-implicit-coercion': [ 'error', {
            number: true,
            'boolean': true,
            string: true,
        } ],
        'no-mixed-operators': [ 'error', {
            groups: [
                [ '&&', '||' ],
            ],
        } ],
        'no-mixed-spaces-and-tabs': 'error',
        'no-multiple-empty-lines': [ 'error', {
            max: 1,
            maxEOF: 0,
            maxBOF: 0,
        } ],
        'no-multi-spaces': 'error',
        'no-multi-str': 'error',
        'no-nested-ternary': 'error',
        // Это правило добавили в eslint@6 в eslint:recommended. Оно нам не надо
        'no-prototype-builtins': 'off',
        'no-trailing-spaces': 'error',
        'no-spaced-func': 'error',
        'no-with': 'error',
        'object-curly-spacing': [ 'error', 'always' ],
        'object-shorthand': 'off',
        'one-var': [ 'error', 'never' ],
        'operator-linebreak': [ 'error', 'after' ],
        'prefer-const': 'error',
        'quote-props': [ 'error', 'as-needed', {
            keywords: true,
            numbers: true,
        } ],
        quotes: [ 'error', 'single', {
            allowTemplateLiterals: true,
        } ],
        radix: 'error',
        semi: [ 'error', 'always' ],
        'space-before-function-paren': [ 'error', 'never' ],
        'space-before-blocks': [ 'error', 'always' ],
        'space-in-parens': [ 'error', 'never' ],
        'space-infix-ops': 'error',
        'space-unary-ops': 'off',
        'sort-destructure-keys/sort-destructure-keys': [ 2, { caseSensitive: false } ],
        'template-curly-spacing': [ 'error', 'always' ],
        'valid-jsdoc': [ 'error', {
            requireParamDescription: false,
            requireReturnDescription: false,
            requireReturn: false,
            prefer: {
                'return': 'returns',
            },
        } ],
        'wrap-iife': [ 'error', 'inside' ],
        yoda: [ 'error', 'never', { exceptRange: true } ],

        'jest/consistent-test-it': [ 'error', {
            fn: 'it',
            withinDescribe: 'it',
        } ],
        'jest/expect-expect': [ 'error', { assertFunctionNames: [ 'expect' ] } ],
        'jest/no-alias-methods': 'error',
        'jest/no-disabled-tests': 'error',
        'jest/no-focused-tests': 'error',
        'jest/no-identical-title': 'error',
        'jest/prefer-to-contain': 'error',
        'jest/prefer-to-have-length': 'error',
        'jest/no-large-snapshots': [ 'error', { maxSize: 500 } ],
        'jest/valid-expect': 'error',

        'regexp/confusing-quantifier': 'error',
        'regexp/control-character-escape': 'error',
        'regexp/negation': 'error',
        'regexp/no-dupe-disjunctions': 'error',
        'regexp/no-empty-alternative': 'error',
        'regexp/no-empty-capturing-group': 'error',
        'regexp/no-lazy-ends': 'error',
        'regexp/no-obscure-range': [ 'error', {
            allowed: [ 'alphanumeric', 'А-Я', 'а-я' ],
        } ],
        'regexp/no-optional-assertion': 'error',
        'regexp/no-unused-capturing-group': [ 'error', {
            fixable: true,
        } ],
        'regexp/no-useless-character-class': 'error',
        'regexp/no-useless-dollar-replacements': 'error',
    },
    env: {
        browser: true,
        node: true,
        es6: true,
    },
    settings: {
        'import/resolver': {
            node: {
                extensions: [
                    '.js',
                ],
            },
        },
    },
    overrides: [
        {
            files: [ '*.ts' ],
            rules: {
                '@typescript-eslint/no-require-imports': 'error',
                '@typescript-eslint/no-use-before-define': [ 'error', {
                    functions: false,
                } ],
                'prefer-rest-params': 'error',
                'prefer-spread': 'error',
            },
        },
    ],
};
