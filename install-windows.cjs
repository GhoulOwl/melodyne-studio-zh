#!/usr/bin/env node
'use strict';

// Windows x64 Melodyne 5.4.2.006 UI resources only. No external dependencies.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const VERSION = '5.4.2.006';
const OFFSET = 67016806;
const CAPACITY = 94688;
const BOUNDARY = 519243;
const ORIGINAL_DICT = '50215e12a8d5a86b4e6eee40365cc699819404594805ccd55658fd8ea1ac1a6d';
const CHINESE_DICT = 'ecf29bbbe6a32584aa76bf2d19f3b1b23ed82884d7aad14b1d90d9e62e1e8e8c';
// Windows serializes the string encoding tag differently from the macOS file.
const RECORD = Buffer.from([9,0,0,0,5,0,0,0,0,0,0,0,0,1,0,0,0,7,0,0,0,0,0,0,0]);
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const decoder = new TextDecoder('utf-16le', { fatal: true });

function records(buf) {
  const rows = [];
  for (let p = buf.indexOf(RECORD); p >= 0; p = buf.indexOf(RECORD, p + RECORD.length)) {
    assert.ok(p >= 4 && p + 33 <= buf.length, '字符串记录头越界');
    const n = buf.readUInt32LE(p + 25);
    assert.ok(n >= 2 && n <= 20000 && n % 2 === 0 && p + 33 + n <= buf.length, '字符串长度无效');
    assert.equal(buf.readUInt32LE(p + 29), n, '字符串长度字段不一致');
    assert.equal(buf.readUInt32LE(p - 4), n + 33, '字符串记录长度不一致');
    assert.equal(buf.readUInt16LE(p + 33 + n - 2), 0, '字符串缺少结束符');
    const s = decoder.decode(buf.subarray(p + 33, p + 33 + n - 2));
    assert.ok(!s.includes('\0'), '字符串包含嵌入的结束符');
    rows.push({ p, n, s });
  }
  return rows;
}

const tokens = s => s.match(/%(?:\d+\$)?[-+ #0]*(?:\d+|\*)?(?:\.(?:\d+|\*))?(?:hh|ll|[hlzjtL])?[A-Za-z@]|\$[A-Za-z_][A-Za-z_0-9]*|[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/g) || [];

function translateRecords(source, translations, boundary, expectedCount) {
  const rows = records(source);
  const changes = rows.filter(r => r.p >= boundary &&
    translations[digest(Buffer.from(r.s, 'utf8'))] !== undefined &&
    translations[digest(Buffer.from(r.s, 'utf8'))] !== r.s);
  assert.equal(changes.length, expectedCount, '匹配的翻译数量异常');
  let result = Buffer.from(source);
  for (const { p, n, s } of changes.slice().reverse()) {
    const t = translations[digest(Buffer.from(s, 'utf8'))];
    assert.equal(typeof t, 'string', '翻译必须是字符串');
    assert.ok(!t.includes('\0'), '翻译包含结束符');
    assert.deepEqual(tokens(s), tokens(t), '翻译的格式变量不匹配');
    const value = Buffer.from(t + '\0', 'utf16le');
    result = Buffer.concat([result.subarray(0, p + 33), value, result.subarray(p + 33 + n)]);
    result.writeUInt32LE(value.length, p + 25);
    result.writeUInt32LE(value.length, p + 29);
    result.writeUInt32LE(value.length + 33, p - 4);
  }
  const finalRows = records(result);
  assert.equal(finalRows.length, rows.length, '翻译后的记录数量发生变化');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const expected = row.p >= boundary ? (translations[digest(Buffer.from(row.s, 'utf8'))] ?? row.s) : row.s;
    assert.equal(finalRows[i].s, expected, `翻译后的第 ${i} 条记录不匹配`);
  }
  return { result, count: changes.length, records: rows.length };
}

function validatePE(data) {
  assert.ok(data.length >= 64 && data.toString('ascii', 0, 2) === 'MZ', '不是 Windows PE 文件');
  const pe = data.readUInt32LE(60);
  assert.ok(pe + 24 <= data.length && data.toString('ascii', pe, pe + 4) === 'PE\0\0', 'PE 文件头无效');
  assert.equal(data.readUInt16LE(pe + 4), 0x8664, '仅支持 Windows x64');
  assert.equal(data.readUInt16LE(pe + 24), 0x20b, '仅支持 PE32+');
  const sectionCount = data.readUInt16LE(pe + 6);
  const sectionStart = pe + 24 + data.readUInt16LE(pe + 20);
  assert.ok(sectionStart + sectionCount * 40 <= data.length, 'PE 节表越界');
  let resource;
  for (let i = 0; i < sectionCount; i++) {
    const p = sectionStart + i * 40;
    if (data.toString('ascii', p, p + 8).replace(/\0/g, '') === '.rsrc') {
      assert.ok(!resource, '存在重复的资源节');
      resource = { start: data.readUInt32LE(p + 20), size: data.readUInt32LE(p + 16) };
    }
  }
  assert.ok(resource && resource.start + resource.size <= data.length, '资源节无效');
  assert.ok(OFFSET >= resource.start && OFFSET + 20 + CAPACITY <= resource.start + resource.size, '语言字典不在预期资源节内');
  const region = data.subarray(resource.start, resource.start + resource.size);
  const signature = Buffer.from('bd04effe00000100', 'hex');
  const fixedInfo = region.indexOf(signature);
  assert.ok(fixedInfo >= 0 && fixedInfo + 52 <= region.length && region.indexOf(signature, fixedInfo + 1) < 0, '版本信息不明确');
  assert.equal(region.readUInt32LE(fixedInfo + 8), 0x00050004, '需要 Melodyne 5.4.2.006');
  assert.equal(region.readUInt32LE(fixedInfo + 12), 0x00020006, '需要 Melodyne 5.4.2.006');
  assert.equal(data.toString('ascii', OFFSET, OFFSET + 4), 'GNBK', '语言容器格式不匹配');
}

function prepare(data, translations) {
  validatePE(data);
  const compressedSize = data.readUInt32LE(OFFSET + 16);
  assert.ok(compressedSize > 0 && compressedSize <= CAPACITY, '语言容器大小异常');
  const source = zlib.inflateSync(data.subarray(OFFSET + 20, OFFSET + 20 + compressedSize), { maxOutputLength: 2 * 1024 * 1024 });
  const originalHash = digest(source);
  if (originalHash === CHINESE_DICT) return { alreadyPatched: true };
  assert.equal(originalHash, ORIGINAL_DICT, 'Windows 语言字典指纹不匹配；不能用于其他版本或未知资源');
  assert.equal(compressedSize, CAPACITY, '原始语言容器大小不匹配');
  const translated = translateRecords(source, translations, BOUNDARY, 2040);
  assert.equal(translated.records, 4751, '原始语言字典记录数量异常');
  assert.equal(digest(translated.result), CHINESE_DICT, '翻译字典指纹不匹配');
  assert.ok(source.subarray(0, BOUNDARY - 4).equals(translated.result.subarray(0, BOUNDARY - 4)), '字典的键或元数据发生变化');
  // Different zlib versions choose different block layouts. Keep the smallest
  // valid stream within the original fixed-size slot, without moving PE data.
  const candidates = [];
  for (const strategy of [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FILTERED]) {
    for (const memLevel of [7, 8, 9]) {
      candidates.push(zlib.deflateSync(translated.result, { level: 9, strategy, memLevel }));
    }
  }
  const compressed = candidates.sort((a, b) => a.length - b.length)[0];
  assert.ok(compressed.length <= CAPACITY, '翻译后的字典超过资源空间；不会写入文件');
  const result = Buffer.from(data);
  result.writeUInt32LE(compressed.length, OFFSET + 16);
  result.fill(0, OFFSET + 20, OFFSET + 20 + CAPACITY);
  compressed.copy(result, OFFSET + 20);
  assert.ok(zlib.inflateSync(result.subarray(OFFSET + 20, OFFSET + 20 + compressed.length)).equals(translated.result), '资源重打包校验失败');
  assert.equal(result.length, data.length);
  assert.ok(result.subarray(0, OFFSET + 16).equals(data.subarray(0, OFFSET + 16)));
  assert.ok(result.subarray(OFFSET + 20 + CAPACITY).equals(data.subarray(OFFSET + 20 + CAPACITY)));
  return { result, count: translated.count, records: translated.records, compressedSize: compressed.length };
}

function writeAll(fd, buffer) {
  let written = 0;
  while (written < buffer.length) {
    const n = fs.writeSync(fd, buffer, written, buffer.length - written, written);
    assert.ok(n > 0, '文件写入中断');
    written += n;
  }
  fs.fsyncSync(fd);
}

function replaceFile(target, replacement, expectedHash, beforeWrite = () => {}) {
  // Windows rejects writes while a process maps this DLL. Do not rename around
  // that lock, terminate audio hosts, or change file permissions.
  const fd = fs.openSync(target, 'r+');
  let original, attempted = false;
  try {
    original = fs.readFileSync(fd);
    assert.equal(digest(original), expectedHash, '目标文件已变化；停止覆盖');
    assert.equal(original.length, replacement.length, '恢复或安装文件的大小不一致');
    beforeWrite(original);
    attempted = true;
    writeAll(fd, replacement);
    assert.equal(digest(fs.readFileSync(target)), digest(replacement), '写入后的文件校验失败');
  } catch (error) {
    if (attempted) {
      try {
        writeAll(fd, original);
        assert.equal(digest(fs.readFileSync(target)), digest(original));
      } catch (rollbackError) {
        throw new Error(`写入和自动恢复均失败；请从备份恢复。${rollbackError.message}`, { cause: error });
      }
    }
    throw error;
  } finally {
    fs.closeSync(fd);
  }
}

function options(args) {
  const result = { check: false, restore: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--check') result.check = true;
    else if (arg === '--restore') result.restore = true;
    else if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--source' || arg === '--backup') {
      assert.ok(args[i + 1] && !args[i + 1].startsWith('--'), `${arg} 缺少路径`);
      result[arg.slice(2)] = path.resolve(args[++i]);
    } else throw new Error(`未知参数：${arg}`);
  }
  assert.ok(!(result.check && result.restore), '--check 不能与 --restore 同时使用');
  return result;
}

function main(args = process.argv.slice(2)) {
  const opts = options(args);
  if (opts.help) {
    console.log('用法：node install-windows.cjs [--check | --restore] [--source DLL路径] [--backup 备份目录]\n默认安装需要管理员权限。--check 只校验，不写入。');
    return;
  }
  assert.equal(process.platform, 'win32', '本脚本仅支持 Windows；macOS 请使用 install.py');
  const common = process.env.CommonProgramW6432 || process.env.CommonProgramFiles || 'C:\\Program Files\\Common Files';
  const target = opts.source || path.join(common, 'Celemony', 'Bundles', `MelodyneCore-${VERSION}.dll`);
  const backup = opts.backup || target + '.zh-backup';
  const source = fs.readFileSync(target);
  if (opts.restore) {
    const manifest = JSON.parse(fs.readFileSync(path.join(backup, 'manifest.json'), 'utf8'));
    assert.equal(manifest.schema, 1, '备份格式不匹配');
    assert.equal(manifest.version, VERSION, '备份版本不匹配');
    assert.equal(path.resolve(manifest.target).toLowerCase(), path.resolve(target).toLowerCase(), '备份属于其他目标路径');
    const original = fs.readFileSync(path.join(backup, 'original.dll'));
    assert.equal(digest(original), manifest.originalSha256, '原文件备份已损坏');
    if (digest(source) === manifest.originalSha256) { console.log('已是备份中的原文件，无需恢复。'); return; }
    assert.equal(digest(source), manifest.patchedSha256, '安装文件已更新或变化；不会覆盖其他版本');
    replaceFile(target, original, manifest.patchedSha256);
    console.log(`恢复完成：${target}\n备份已保留：${backup}`);
    return;
  }
  const translations = JSON.parse(fs.readFileSync(path.join(__dirname, 'zh-Hans.json'), 'utf8'));
  const prepared = prepare(source, translations);
  if (prepared.alreadyPatched) { console.log('已安装本项目的简体中文语言字典。'); return; }
  console.log(`兼容校验通过：${VERSION} Windows x64，${prepared.records} 条记录，${prepared.count} 条翻译。`);
  if (opts.check) { console.log('只读检查完成，未修改任何文件。'); return; }
  assert.ok(!fs.existsSync(backup), `备份目录已存在，不会覆盖：${backup}`);
  const manifest = { schema: 1, version: VERSION, target: path.resolve(target), originalSha256: digest(source), patchedSha256: digest(prepared.result), translatedRecords: prepared.count, created: new Date().toISOString() };
  replaceFile(target, prepared.result, manifest.originalSha256, original => {
    fs.mkdirSync(backup);
    fs.writeFileSync(path.join(backup, 'original.dll'), original, { flag: 'wx' });
    assert.equal(digest(fs.readFileSync(path.join(backup, 'original.dll'))), manifest.originalSha256, '备份校验失败');
    fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  });
  console.log(`汉化完成：${target}\n备份目录：${backup}\n请重新启动 Melodyne；语言选择 English。`);
}

module.exports = { records, tokens, translateRecords, validatePE, prepare, replaceFile, options, digest, RECORD };
if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`错误：${error.message}\n请关闭 Melodyne 和音频宿主，安装或恢复时使用管理员终端。不要绕过版本或语言字典指纹检查。`);
    process.exitCode = 1;
  }
}
