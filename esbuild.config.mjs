import esbuild from 'esbuild';
import process from 'process';
import fs from 'fs';
import path from 'path';

const prod = process.argv[2] === 'production';

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/main.js',
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
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

  // Copy manifest.json into dist so the dist folder is directly installable
  fs.copyFileSync('manifest.json', path.join('dist', 'manifest.json'));

  // Create a drop-in release folder: release/nexavault/{main.js, manifest.json}
  const releaseDir = path.join('release', 'nexavault');
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.copyFileSync(path.join('dist', 'main.js'), path.join(releaseDir, 'main.js'));
  fs.copyFileSync('manifest.json', path.join(releaseDir, 'manifest.json'));

  // ALSO emit main.js at repo root so `git clone` into a plugin folder
  // works directly (manifest.json is already at the root).
  fs.copyFileSync(path.join('dist', 'main.js'), path.join('.', 'main.js'));
  console.log('✅ main.js written to: repo root, dist/, release/nexavault/');
  process.exit(0);
} else {
  await context.watch();
}
