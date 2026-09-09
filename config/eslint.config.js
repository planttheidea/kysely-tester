import { createEslintConfig } from '@planttheidea/build-tools';

export default createEslintConfig({
  config: 'config',
  react: false,
  source: 'src',
  configs: [
    {
      files: ['config/**/*.js'],
      rules: {
        // `eslint-plugin-import` parses at ES2018, so following an import into a
        // modern dependency reports that dependency's syntax as a parse error.
        // TypeScript already resolves these specifiers.
        'import/default': 'off',
        'import/namespace': 'off',
        'import/no-named-as-default': 'off',
        'import/no-named-as-default-member': 'off',
      },
    },
  ],
});
