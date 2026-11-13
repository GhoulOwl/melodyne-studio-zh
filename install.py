#!/usr/bin/env python3
"""Build a separate Chinese-language Melodyne 5.4.2 macOS app from local files."""
import argparse, hashlib, json, os, re, shutil, struct, subprocess, sys, zlib
from pathlib import Path

VERSION='5.4.2.006'
LOADER_HASH='9bffefc4338ebb5ba77ccf379dde8f2c298525d372ef29c76ab35a952d99ea1f'
RESOURCE_HASHES={'MelodyneCore-5.4.2.006.sbb':'0699d4fe62038a44b096cb80cbe34972f392c0d88c9dbc8e5cecabdce3ee7241','MelodyneCoreF-5.4.2.006.sbb':'3a6b201239437be5615b40ae96b14939734d5611f6cb4aee9c38443644ab4b4c'}
DICT_HASH='bab5ce565220fcdad61a8564bcd0dfffa80924b13daac7b09c4774d6af0034cb'
PREFIX=b'/Library/Application Support/Celemony/Bundles/'
RECORD=bytes.fromhex('09 00 00 00 00 05 00 00 00 00 00 00 00 01 00 00 00 07 00 00 00 00 00 00 00')
OFF=18001898; SLOT=94713

def digest(b): return hashlib.sha256(b).hexdigest()
def die(message): raise SystemExit('错误：'+message)
def run(*cmd): subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL)
def records(buf):
    for m in re.finditer(re.escape(RECORD),buf):
        i=m.start(); n=struct.unpack_from('<I',buf,i+25)[0]
        if n<2 or n>20000 or n!=struct.unpack_from('<I',buf,i+29)[0]: continue
        try: s=buf[i+33:i+33+n].decode('utf-16-le').rstrip('\0')
        except UnicodeDecodeError: continue
        yield i,n,s

def patch_resource(data, translations):
    if data[OFF:OFF+4]!=b'GNBK': die('字典容器格式不匹配')
    n=struct.unpack_from('<I',data,OFF+16)[0]
    source=zlib.decompress(data[OFF+20:OFF+20+n])
    if digest(source)!=DICT_HASH: die('语言字典指纹不匹配')
    out=bytearray(source); count=0
    for i,n,s in reversed(list(records(source))):
        if i<519243: continue
        t=translations.get(digest(s.encode('utf-8')))
        if t is None or s==t: continue
        tokens=lambda x: re.findall(r'%(?:\d+\$)?[-+ #0]*(?:\d+|\*)?(?:\.(?:\d+|\*))?(?:hh|ll|[hlzjtL])?[A-Za-z@]|\$[A-Za-z_][A-Za-z_0-9]*|[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]',x)
        if tokens(s)!=tokens(t): die('翻译的格式变量不匹配')
        new=(t+'\0').encode('utf-16-le')
        if struct.unpack_from('<I',out,i-4)[0]!=n+33: die('字典记录格式不匹配')
        out[i+33:i+33+n]=new
        struct.pack_into('<I',out,i+25,len(new));struct.pack_into('<I',out,i+29,len(new));struct.pack_into('<I',out,i-4,len(new)+33);count+=1
    if count!=2040: die(f'匹配词条数量异常：{count}（应为 2040）')
    zipped=zlib.compress(out,9);cap=SLOT-20
    if len(zipped)>cap: die('翻译后的字典超过资源空间')
    result=bytearray(data);struct.pack_into('<I',result,OFF+16,len(zipped));result[OFF+20:OFF+SLOT]=zipped+b'\0'*(cap-len(zipped))
    if zlib.decompress(result[OFF+20:OFF+20+len(zipped)])!=out: die('资源重打包校验失败')
    return bytes(result)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-app',type=Path,default=Path('/Applications/Melodyne 5/Melodyne.app'))
    parser.add_argument('--output',type=Path,default=Path.home()/'Applications'/'Melodyne 中文.app')
    parser.add_argument('--support-dir',type=Path,default=Path('/Users/Shared')/f'MelodyneZH-{os.getuid()}')
    args=parser.parse_args();source=args.source_app.expanduser().resolve();dest=args.output.expanduser().absolute();support=args.support_dir.expanduser().absolute()
    if sys.platform!='darwin': die('仅支持 macOS')
    if not source.is_dir(): die(f'找不到原始应用：{source}')
    binary=source/'Contents/MacOS/Melodyne'
    if not binary.is_file() or digest(binary.read_bytes())!=LOADER_HASH: die('应用文件指纹不匹配；请使用本项目验证过的 5.4.2.006 原始安装，不能使用已修改的应用。')
    prefix=(str(support)+'/').encode('utf-8')
    if len(prefix)>len(PREFIX) or b'\0' in prefix: die('资源目录路径过长，请选择更短的绝对路径。')
    if support.exists() or support.is_symlink() or dest.exists() or dest.is_symlink(): die('目标应用或资源目录已存在；为保护现有文件，程序不会覆盖。')
    root=Path('/Library/Application Support/Celemony/Bundles');resources={}
    for name,expected in RESOURCE_HASHES.items():
        p=root/name/'Contents/Resources/Resources.rrr'
        if not p.is_file():die(f'缺少资源：{p}')
        raw=p.read_bytes()
        if digest(raw)!=expected:die(f'资源指纹不匹配：{name}')
        resources[name]=raw
    translations=json.loads((Path(__file__).resolve().parent/'zh-Hans.json').read_text(encoding='utf8'))
    prepared={name:patch_resource(data,translations) for name,data in resources.items()}
    dest.parent.mkdir(parents=True,exist_ok=True)
    made_support=False; made_dest=False
    try:
        support.mkdir(mode=0o700);made_support=True;os.chmod(support,0o700)
        for name,data in prepared.items():
            target=support/name;shutil.copytree(root/name,target,symlinks=True)
            (target/'Contents/Resources/Resources.rrr').write_bytes(data)
            run('/usr/bin/codesign','--force','--sign','-',str(target))
            run('/usr/bin/codesign','--verify','--strict',str(target))
        dest.mkdir();made_dest=True
        shutil.copytree(source,dest,symlinks=True,dirs_exist_ok=True)
        b=dest/'Contents/MacOS/Melodyne';data=b.read_bytes()
        if data.count(PREFIX)!=2:die('应用加载路径数量不匹配')
        b.write_bytes(data.replace(PREFIX,prefix+b'/'*(len(PREFIX)-len(prefix))))
        run('/usr/bin/codesign','--force','--sign','-',str(dest))
        run('/usr/bin/codesign','--verify','--strict',str(dest))
    except BaseException:
        # Only remove targets that did not exist at the start of this run.
        if made_dest: shutil.rmtree(dest)
        if made_support: shutil.rmtree(support)
        raise
    print(f'完成：{dest}\n资源目录：{support}\n原版应用与系统插件未修改。')

if __name__=='__main__': main()
