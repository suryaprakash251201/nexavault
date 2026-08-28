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

  // Copy manifest.json into dist so the folder is directly installable
  fs.copyFileSync('manifest.json', path.join('dist', 'manifest.json'));
  if (fs.existsSync('styles.css')) {
    fs.copyFileSync('styles.css', path.join('dist', 'styles.css'));
  }

  // Create a drop-in release folder: release/nexavault/{main.js, manifest.json, styles.css?}
  const releaseDir = path.join('release', 'nexavault');
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.copyFileSync(path.join('dist', 'main.js'), path.join(releaseDir, 'main.js'));
  fs.copyFileSync('manifest.json', path.join(releaseDir, 'manifest.json'));
  if (fs.existsSync('styles.css')) {
    fs.copyFileSync('styles.css', path.join(releaseDir, 'styles.css'));
  }
  console.log('✅ release/nexavault/ ready — copy this folder into .obsidian/plugins/');
  process.exit(0);
} else {
  await context.watch();
}
