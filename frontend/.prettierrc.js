module.exports = {
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  trailingComma: 'es5',
  bracketSpacing: true,
  arrowParens: 'always',
  endOfLine: 'lf',
  htmlWhitespaceSensitivity: 'ignore',
  overrides: [
    {
      files: '*.component.html',
      options: {
        parser: 'angular',
      },
    },
    {
      files: ['*.json', '.eslintrc', '.babelrc'],
      options: {
        tabWidth: 2,
      },
    },
  ],
};
