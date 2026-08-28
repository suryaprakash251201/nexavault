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

  // ---- Copy installable artifacts (main.js, manifest.json, styles.css) ----
  const releaseDir = path.join('release', 'nexavault');
  fs.mkdirSync(releaseDir, { recursive: true });

  const artifacts = [
    ['dist/main.js', 'main.js'],
    ['manifest.json', 'manifest.json'],
  ];
  if (fs.existsSync('styles.css')) artifacts.push(['styles.css', 'styles.css']);

  for (const [src, name] of artifacts) {
    fs.copyFileSync(src, path.join('dist', name));          // dist/
    fs.copyFileSync(src, path.join(releaseDir, name));      // release/nexavault/
    fs.copyFileSync(src, path.join('.', name));             // repo root (clone-installable)
  }
  // versions.json: repo root (required) + release so users on old versions get updates
  fs.copyFileSync('versions.json', path.join(releaseDir, 'versions.json'));
  console.log('✅ Artifacts (main.js, manifest.json, styles.css) at: repo root, dist/, release/nexavault/');
  process.exit(0);
} else {
  await context.watch();
}
