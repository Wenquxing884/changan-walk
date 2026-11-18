import { mkdir, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import process from 'node:process';

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const temp = resolve(root, '.tmp', 'esbuild');
await mkdir(temp, { recursive: true });
// Keep compiler scratch files in the workspace: this machine's shared TEMP has
// restrictive delete permissions, which otherwise causes esbuild to fail.
process.env.TMP = temp;
process.env.TEMP = temp;
process.env.TMPDIR = temp;
const output = resolve(root, 'dist');
await mkdir(output, { recursive: true });
const outputReal = await realpath(output);
const child = relative(root, outputReal);
if (outputReal !== output || child.startsWith('..') || isAbsolute(child) || child === '') throw new Error('Build output must be inside this project.');
const { build } = await import('vite');
await build({ root, configFile: resolve(root, 'vite.config.js'), configLoader: 'native', build: { outDir: output, emptyOutDir: true } });
