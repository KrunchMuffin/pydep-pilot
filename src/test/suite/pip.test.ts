import * as assert from 'assert';
import { createPackageInfo, comparePackageVersions } from '@/modules/PackageInfo';

suite('Package Manager API', function () {
	this.timeout(30000);
	test('parses package names and exact versions', () => {
		const parse = createPackageInfo;
		assert.strictEqual(parse('six==1.16.0')?.toString(), 'six==1.16.0');
		assert.strictEqual(parse({ name: 'six', version: '1.17.0' })?.toString(), 'six==1.17.0');
		assert.strictEqual(parse('six')?.version, undefined);
		assert.strictEqual(parse(''), null);
		assert.strictEqual(parse({ name: '' }), null);
		assert.strictEqual(parse('six==')?.toString(), 'six');
	});

	test('sorts numeric versions descending, preserving suffix and missing-component behavior', () => {
		const versions = ['1.2', '1.10', '2.0', '1.2.1'];
		assert.deepStrictEqual(versions.sort(comparePackageVersions), ['2.0', '1.10', '1.2.1', '1.2']);
		assert.strictEqual(comparePackageVersions('1.0.0', '1'), 0);
		assert.strictEqual(comparePackageVersions('1.2rc1', '1.21'), 0);
		assert.strictEqual(comparePackageVersions('1.dev', '1.0'), 0);
	});
});
