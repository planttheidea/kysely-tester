import { createEslintConfig } from '@planttheidea/build-tools';

export default createEslintConfig({
  config: 'config',
  react: false,
  source: 'src',
  configs: [
    {
      // The integration suite is a test folder by every measure except its name,
      // which has to differ so the unit config's glob leaves it alone.
      files: ['__integration__/**/*.ts'],
      languageOptions: {
        parserOptions: { projectService: true },
      },
    },
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
