import esbuild from 'esbuild';
import process from 'process';

const prod = process.argv[2] === 'production';

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/main.js',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  sourcemap: prod ? true : 'inline',
  minify: prod,
  treeShaking: true,
  external: [
    'obsidian',
    'electron',
    '@codemirror/*',
    '@lezer/*',
    'codemirror',
  ],
  define: {
    'process.env.NODE_ENV': prod ? '"production"' : '"development"',
  },
  logLevel: 'info',
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
