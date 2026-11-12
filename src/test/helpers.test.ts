import * as assert from 'assert';
import {
    escapeHtml, getCspNonce, clampSpeed, errorToString,
    formatTemplate, extractTemplateVariables, truncate, generateId
} from '../core/helpers';

suite('Helpers', () => {
    test('escapeHtml escapes special characters', () => {
        assert.strictEqual(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    });

    test('getCspNonce returns 32-char string', () => {
        const n = getCspNonce();
        assert.strictEqual(n.length, 32);
        assert.ok(/^[A-Za-z0-9]+$/.test(n));
    });

    test('getCspNonce returns different values', () => {
        assert.notStrictEqual(getCspNonce(), getCspNonce());
    });

    test('clampSpeed clamps within range', () => {
        assert.strictEqual(clampSpeed(0), 1);
        assert.strictEqual(clampSpeed(5000), 2000);
        assert.strictEqual(clampSpeed(50), 50);
        assert.strictEqual(clampSpeed('abc'), 10);
        assert.strictEqual(clampSpeed(null), 10);
    });

    test('errorToString handles Error and non-Error', () => {
        assert.strictEqual(errorToString(new Error('boom')), 'boom');
        assert.strictEqual(errorToString('str'), 'str');
        assert.strictEqual(errorToString(42), '42');
    });

    test('formatTemplate replaces known vars', () => {
        assert.strictEqual(formatTemplate('Hi {name}!', { name: 'Ali' }), 'Hi Ali!');
    });

    test('formatTemplate leaves missing vars intact', () => {
        assert.strictEqual(formatTemplate('Hi {name}!', {}), 'Hi {name}!');
    });

    test('extractTemplateVariables finds unique keys in order', () => {
        assert.deepStrictEqual(extractTemplateVariables('{a} {b} {a} {c}'), ['a', 'b', 'c']);
    });

    test('truncate shortens long strings', () => {
        assert.strictEqual(truncate('abcdef', 10), 'abcdef');
        assert.strictEqual(truncate('abcdef', 4), 'abc…');
    });

    test('generateId produces prefixed unique ids', () => {
        const a = generateId('conv');
        const b = generateId('conv');
        assert.ok(a.startsWith('conv_'));
        assert.notStrictEqual(a, b);
    });
});
