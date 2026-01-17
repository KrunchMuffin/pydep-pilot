const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Custom plugin to resolve @/ path aliases
const aliasPlugin = {
  name: 'alias',
  setup(build) {
    // Resolve @/ to src/
    build.onResolve({ filter: /^@\// }, args => {
      const importPath = args.path.replace(/^@\//, '');
      const basePath = path.resolve(__dirname, 'src', importPath);

      // Try different extensions and index files
      const candidates = [
        basePath + '.ts',
        basePath + '.js',
        path.join(basePath, 'index.ts'),
        path.join(basePath, 'index.js'),
      ];

      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          return { path: candidate };
        }
      }

      // Fall back to original path
      return { path: basePath };
    });
  }
};

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd(result => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location == null) return;
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  }
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'out/extension.js',
    external: ['vscode'],
    logLevel: 'warning',
    plugins: [
      aliasPlugin,
      esbuildProblemMatcherPlugin
    ]
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
