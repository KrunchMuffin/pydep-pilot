import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';

import { i18n } from '@/common/i18n/localize';

suite('Extension I18n Test Suite', () => {
	test('i18n test: default value', () => {
		assert.strictEqual('use default', i18n.localize('key.of.any', 'use default'));
		assert.strictEqual('no key use default', i18n.localize('', 'no key use default'));
	});

	test('i18n test: argument substitution', () => {
		assert.strictEqual('use default with args arg0', i18n.localize('key.of.any', 'use default with args %0%', 'arg0'));
		assert.strictEqual('multiple args: first second', i18n.localize('key.of.any', 'multiple args: %0% %1%', 'first', 'second'));
	});
});
