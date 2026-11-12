import * as assert from 'assert';
import { scrubSecrets, scrub } from '../core/secretScrubber';

suite('SecretScrubber', () => {
    test('returns empty result for empty input', () => {
        const r = scrubSecrets('');
        assert.strictEqual(r.text, '');
        assert.strictEqual(r.redactedCount, 0);
        assert.deepStrictEqual(r.redactedKinds, []);
    });

    test('leaves non-secret text untouched', () => {
        const input = 'const x = 42; // no secrets here';
        const r = scrubSecrets(input);
        assert.strictEqual(r.text, input);
        assert.strictEqual(r.redactedCount, 0);
    });

    test('redacts OpenAI-style sk- key', () => {
        const input = 'key = sk-abcdefghijklmnopqrstuvwxyz123456';
        const r = scrubSecrets(input);
        assert.ok(r.redactedCount >= 1);
        assert.ok(!r.text.includes('abcdefghijklmnopqrstuvwxyz123456'));
        assert.ok(r.text.includes('[REDACTED:sk-key]'));
    });

    test('redacts Anthropic key', () => {
        const input = 'token: sk-ant-abcdefghijklmnop1234567890';
        const r = scrubSecrets(input);
        assert.ok(r.redactedKinds.includes('anthropic'));
        assert.ok(r.text.includes('[REDACTED:anthropic]'));
    });

    test('redacts Google/Gemini AIza key', () => {
        const input = 'const k = "AIzaSyA1234567890abcdefghijklmnopqrstu";';
        const r = scrubSecrets(input);
        assert.ok(r.redactedKinds.includes('google'));
        assert.ok(!r.text.includes('AIzaSyA1234567890abcdefghijklmnopqrstu'));
    });

    test('redacts GitHub PAT', () => {
        const input = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
        const r = scrubSecrets(input);
        assert.ok(r.redactedKinds.includes('github-pat'));
    });

    test('redacts AWS access key', () => {
        const input = 'AKIAIOSFODNN7EXAMPLE';
        const r = scrubSecrets(input);
        assert.ok(r.redactedKinds.includes('aws-access'));
    });

    test('redacts password assignment', () => {
        const input = 'const password = "supersecret123";';
        const r = scrubSecrets(input);
        assert.ok(r.redactedKinds.includes('assignment'));
        assert.ok(!r.text.includes('supersecret123'));
    });

    test('redacts multiple distinct secrets and reports kinds', () => {
        const input = 'a=sk-abcdefghijklmnopqrstuvwxyz123 b=AKIAIOSFODNN7EXAMPLE';
        const r = scrubSecrets(input);
        assert.ok(r.redactedCount >= 2);
        assert.ok(r.redactedKinds.includes('sk-key'));
        assert.ok(r.redactedKinds.includes('aws-access'));
    });

    test('scrub() convenience returns text only', () => {
        const input = 'sk-abcdefghijklmnopqrstuvwxyz123456';
        const out = scrub(input);
        assert.ok(out.includes('[REDACTED:sk-key]'));
    });
});
