import * as assert from 'assert';
import * as path from 'path';
import { createBackend, isUvManagedEnvironment, pyvenvCfgPathFor } from '@/modules/PackageBackend';

suite('Package Backend Test Suite', () => {
	const py = String.raw`C:\proj\.venv\Scripts\python.exe`;

	test('pip backend runs python -m pip', () => {
		const b = createBackend('pip', py);
		assert.strictEqual(b.kind, 'pip');
		assert.deepStrictEqual(b.list(), { command: py, args: ['-m', 'pip', 'list', '--format', 'json'] });
		assert.deepStrictEqual(b.freeze(), { command: py, args: ['-m', 'pip', 'freeze'] });
		assert.deepStrictEqual(
			b.outdated('https://pypi.org/simple'),
			{ command: py, args: ['-m', 'pip', 'list', '--outdated', '--format', 'json', '-i', 'https://pypi.org/simple'] }
		);
		assert.deepStrictEqual(
			b.install(['six==1.17.0'], { upgrade: true, indexUrl: 'https://pypi.org/simple' }),
			{ command: py, args: ['-m', 'pip', 'install', '-U', 'six==1.17.0', '-i', 'https://pypi.org/simple'] }
		);
		assert.deepStrictEqual(
			b.install([], { upgrade: true, requirementsFile: 'req.txt' }),
			{ command: py, args: ['-m', 'pip', 'install', '-U', '-r', 'req.txt'] }
		);
		assert.deepStrictEqual(b.uninstall('six'), { command: py, args: ['-m', 'pip', 'uninstall', 'six', '-y'] });
	});

	test('uv backend runs uv pip with --python and --default-index', () => {
		const b = createBackend('uv', py, 'uv');
		assert.strictEqual(b.kind, 'uv');
		assert.deepStrictEqual(b.list(), { command: 'uv', args: ['pip', 'list', '--format', 'json', '--python', py] });
		assert.deepStrictEqual(b.freeze(), { command: 'uv', args: ['pip', 'freeze', '--python', py] });
		assert.deepStrictEqual(
			b.outdated('https://pypi.org/simple'),
			{ command: 'uv', args: ['pip', 'list', '--outdated', '--format', 'json', '--default-index', 'https://pypi.org/simple', '--python', py] }
		);
		assert.deepStrictEqual(
			b.install(['six'], { upgrade: true, indexUrl: 'https://pypi.org/simple' }),
			{ command: 'uv', args: ['pip', 'install', '-U', 'six', '--default-index', 'https://pypi.org/simple', '--python', py] }
		);
		assert.deepStrictEqual(
			b.install([], { requirementsFile: 'req.txt' }),
			{ command: 'uv', args: ['pip', 'install', '-r', 'req.txt', '--python', py] }
		);
		// uv never prompts, so no -y
		assert.deepStrictEqual(b.uninstall('six'), { command: 'uv', args: ['pip', 'uninstall', 'six', '--python', py] });
	});

	test('upgrade flag is emitted once', () => {
		const args = createBackend('uv', py).install(['six'], { upgrade: true }).args;
		assert.strictEqual(args.filter(a => a === '-U' || a === '--upgrade').length, 1);
	});

	test('detects uv-managed environments from pyvenv.cfg', () => {
		assert.strictEqual(isUvManagedEnvironment('home = H:\\Python313\nimplementation = CPython\nuv = 0.8.22\nversion_info = 3.13.14\n'), true);
		assert.strictEqual(isUvManagedEnvironment('home = H:\\Python313\ninclude-system-site-packages = false\nversion = 3.13.14\n'), false);
		assert.strictEqual(isUvManagedEnvironment('command = uv venv something\n'), false);
		assert.strictEqual(isUvManagedEnvironment(''), false);
	});

	test('pyvenv.cfg path is two levels above the interpreter', () => {
		assert.strictEqual(
			pyvenvCfgPathFor(py),
			path.join(String.raw`C:\proj\.venv`, 'pyvenv.cfg')
		);
		assert.strictEqual(
			pyvenvCfgPathFor('/home/u/proj/.venv/bin/python'),
			path.join('/home/u/proj/.venv', 'pyvenv.cfg')
		);
		assert.strictEqual(pyvenvCfgPathFor('python'), null);
	});
});
