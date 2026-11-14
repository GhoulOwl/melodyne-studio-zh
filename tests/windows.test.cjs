'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { records, tokens, translateRecords, validatePE, replaceFile, options, digest, RECORD } = require('../install-windows.cjs');

// Synthetic serialization only. No Melodyne data or binaries are test fixtures.
function record(s) {
  const value = Buffer.from(s + '\0', 'utf16le');
  const header = Buffer.alloc(37);
  header.writeUInt32LE(value.length + 33, 0);
  RECORD.copy(header, 4);
  header.writeUInt32LE(value.length, 29);
  header.writeUInt32LE(value.length, 33);
  return Buffer.concat([header, value]);
}
function translations(entries) {
  return Object.fromEntries(entries.map(([s, t]) => [digest(Buffer.from(s)), t]));
}
function tempFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'melodyne-zh-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'synthetic.bin');
  fs.writeFileSync(target, Buffer.from('original content'));
  return { dir, target, original: fs.readFileSync(target) };
}

test('variable length translations preserve keys, following records, and placeholders', () => {
  const input = Buffer.concat([record('key'), record('Save $VarFileName'), record('untouched'), record('Use %s then %d')]);
  const boundary = records(input)[1].p;
  const table = translations([['key', '不得替换键'], ['Save $VarFileName', '保存文件到指定位置：$VarFileName'], ['Use %s then %d', '%s 和 %d']]);
  const output = translateRecords(input, table, boundary, 2);
  assert.deepEqual(records(output.result).map(r => r.s), ['key', '保存文件到指定位置：$VarFileName', 'untouched', '%s 和 %d']);
  assert.equal(output.records, 4);
  assert.ok(input.subarray(0, boundary - 4).equals(output.result.subarray(0, boundary - 4)));
});

test('reordered format variables are refused before any file write', () => {
  assert.throws(() => translateRecords(record('%s %d'), translations([['%s %d', '%d %s']]), 0, 1), /格式变量/);
});

test('unexpected translation count is refused', () => {
  assert.throws(() => translateRecords(record('Save'), {}, 0, 1), /数量/);
});

test('embedded NUL in a translation is refused', () => {
  assert.throws(() => translateRecords(record('Save'), translations([['Save', '保\0存']]), 0, 1), /结束符/);
});

test('corrupt duplicate length, record size, and terminator are refused', () => {
  for (const mutate of [
    b => b.writeUInt32LE(2, 33),
    b => b.writeUInt32LE(2, 0),
    b => b.writeUInt16LE(1, b.length - 2),
  ]) {
    const b = record('Save');
    mutate(b);
    assert.throws(() => records(b));
  }
});

test('invalid UTF-16 is refused', () => {
  const b = record('x');
  b.writeUInt16LE(0xd800, 37);
  assert.throws(() => records(b));
});

test('format tokens include named variables, positional printf, and control bytes', () => {
  assert.deepEqual(tokens('x %2$08.2f $VarName \x01 %%'), ['%2$08.2f', '$VarName', '\x01']);
});

test('PE validation rejects an unrelated file', () => {
  assert.throws(() => validatePE(Buffer.alloc(64)), /PE/);
});

test('replacement creates a backup before changing the target', t => {
  const { dir, target, original } = tempFile(t);
  const replacement = Buffer.from('localized string');
  replaceFile(target, replacement, digest(original), current => {
    assert.ok(fs.readFileSync(target).equals(original));
    fs.writeFileSync(path.join(dir, 'backup.bin'), current);
  });
  assert.ok(fs.readFileSync(target).equals(replacement));
  assert.ok(fs.readFileSync(path.join(dir, 'backup.bin')).equals(original));
});

test('concurrent file changes and failed backup preparation prevent replacement', t => {
  const { target, original } = tempFile(t);
  assert.throws(() => replaceFile(target, Buffer.alloc(original.length), '0'.repeat(64)), /已变化/);
  assert.ok(fs.readFileSync(target).equals(original));
  assert.throws(() => replaceFile(target, Buffer.alloc(original.length), digest(original), () => { throw new Error('backup failed'); }), /backup failed/);
  assert.ok(fs.readFileSync(target).equals(original));
});

test('a partially failed write restores the previous file', t => {
  const { target, original } = tempFile(t);
  const replacement = Buffer.alloc(original.length, 0x41);
  const realWrite = fs.writeSync;
  let failOnce = true;
  t.mock.method(fs, 'writeSync', (fd, buffer, offset, length, position) => {
    if (failOnce) {
      failOnce = false;
      realWrite(fd, buffer, offset, 3, position);
      throw new Error('simulated interrupted write');
    }
    return realWrite(fd, buffer, offset, length, position);
  });
  assert.throws(() => replaceFile(target, replacement, digest(original)), /simulated interrupted write/);
  assert.ok(fs.readFileSync(target).equals(original));
});

test('CLI rejects contradictory, unknown, and incomplete options', () => {
  assert.throws(() => options(['--check', '--restore']));
  assert.throws(() => options(['--source']));
  assert.throws(() => options(['--unknown']));
  assert.equal(options(['--check']).check, true);
});
