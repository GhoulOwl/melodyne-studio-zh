# Windows x64 简体中文汉化

适配 **Melodyne 5.4.2.006 Windows x64**。复用本仓库的 `zh-Hans.json`，替换共享核心 DLL 中的英文语言字典，翻译 2,040 条界面记录。需要自行安装并取得 Melodyne 的使用许可。

Windows 与 macOS 使用不同的容器位置和字符串标记，不能直接运行 macOS 的 `install.py`。本脚本单独核验 Windows PE 架构、文件版本和语言字典 SHA-256；不跳过 macOS 脚本的检查。其他版本或未知字典会被拒绝。

## 安装

需要 **Node.js 22 或更高版本**，不需要 npm 包。先下载并解压整个仓库，保留脚本旁边的 `zh-Hans.json`。

1. 完全退出 Melodyne 和加载 Melodyne 插件的音频宿主。
2. 以管理员身份打开 PowerShell，进入解压后的仓库目录。
3. 先只读检查兼容性，再安装：

```powershell
node .\install-windows.cjs --check
node .\install-windows.cjs
```

4. 照常启动原来的 Melodyne 快捷方式；语言应选择 **English**。脚本将英文词条替换成中文，不新增语言选项。

默认处理：

```text
C:\Program Files\Common Files\Celemony\Bundles\MelodyneCore-5.4.2.006.dll
```

默认在 DLL 旁创建 `MelodyneCore-5.4.2.006.dll.zh-backup` 目录，包含安装前的 `original.dll` 和校验清单 `manifest.json`。**请保留此目录。** 脚本不会覆盖已有备份；遇到权限不足、文件被使用或校验失败会停止，不会关闭宿主、修改权限或绕过文件锁。

安装前先完整备份并校验；写入后重新计算整个 DLL 的 SHA-256。写入发生异常时会尝试恢复本次操作前的内容，备份始终保留。

自定义路径可使用：

```powershell
node .\install-windows.cjs --check --source 'D:\Custom\MelodyneCore-5.4.2.006.dll'
node .\install-windows.cjs --source 'D:\Custom\MelodyneCore-5.4.2.006.dll' --backup 'D:\Backups\Melodyne-before-zh'
```

`--check` 只读，不需要管理员权限，也不创建备份。重复运行时若检测到本项目的中文字典，会提示已安装并停止写入。

## 恢复英文

关闭 Melodyne 和音频宿主，在管理员 PowerShell 中运行：

```powershell
node .\install-windows.cjs --restore
```

使用过自定义 `--source` 或 `--backup` 时，恢复命令也要传入相同路径。恢复前会核验备份及当前 DLL 的完整文件指纹；若 DLL 已被更新或修改，会拒绝覆盖。恢复后保留备份。

如果安装意外中断，也可在关闭相关程序后，用管理员权限将备份的 `original.dll` 复制回原目录并改为原 DLL 文件名。不要拿旧版备份覆盖升级后的软件。

## 验证范围与局限

- 已在一台 Windows 电脑的 Studio 5.4.2.006 独立版验证启动、中文主界面、菜单及偏好设置。
- 自动检查通过：4,751 条字典记录、2,040 条翻译、格式变量及字符串长度、压缩往返、语言资源之外的全部 DLL 字节保持一致。
- 发布脚本已在本机 DLL 副本上完成安装→识别已安装→恢复的往返验证；仓库不包含这些程序文件或测试音频。
- 音频导入、编辑、导出与各类宿主的 VST3/AAX/ARA 功能尚未完成实测。
- Windows 修改的是共享核心库，加载同一核心的插件也可能显示中文；这与 macOS 的独立应用副本方案不同。
- 修改 DLL 会改变文件指纹，并使原有数字签名失效。本脚本不激活软件、不修改授权代码，也不分发程序、音频核心、授权信息或安装包。
- 只适配上述资源版本；升级后需要重新验证。少用界面仍可能有错译、字体或排版问题，请先用非重要工程测试。

## 开发检查

```powershell
node --test .\tests\windows.test.cjs
```

测试只使用合成的字典记录和临时文件，不需要 Melodyne。覆盖可变长度翻译、格式变量、损坏记录、写入前备份、并发修改拒绝和写入中断后的恢复。
