# Windows 与 Android 平台实现

## 本轮范围

- macOS：保留现有 Electron、Apple 端侧识别和 FunASR。
- Windows x64：复用 Electron 双窗口、稿件、排版、双向跟稿和模型管理；新增浏览器麦克风采集与 FunASR 本地推理连接。
- Android：使用 Capacitor 原生壳和独立移动 UI；接入 Android 12+ 系统端侧 `SpeechRecognizer`。
- iOS / iPadOS：不生成工程、不进入条件构建。没有 Apple Developer 账号时仍可做模拟器开发，但无法完成真机签名与分发，本阶段不投入。

## 条件构建

| 目标 | 入口 | 产物 |
| --- | --- | --- |
| macOS / Windows | `src/main.tsx` | `dist/` + Electron |
| Android | `src/main.android.tsx` | `dist-android/` + Capacitor |

桌面入口不引用移动 UI；Android 入口不引用桌面三栏控制台。共享 `session`、稿件锚点、排版、`PrompterSurface` 与双向跟稿算法。

## Windows

Windows AI 跟随只显示 FunASR，不显示不可用的 Apple 引擎。流程如下：

1. Electron 仅向控制窗口授予音频媒体权限，拒绝视频请求。
2. 控制台枚举音频输入，保存用户选择的麦克风 `deviceId`，切换时重启采集。
3. `DesktopStreamingSpeechCapture` 使用 `getUserMedia` 连续采集单声道音频并显示 RMS 响度。
4. 音频线性重采样为 16kHz Float32 PCM，通过受限 IPC 连续传给 Worker。
5. 常驻 sherpa-onnx `OnlineRecognizer` 保留 Paraformer 跨块 cache，持续输出 partial。
6. 拼音对齐层按 partial 推进或确认重读回跳，不等待整句结束。

流式 Paraformer 当前固定 CPU，SenseVoice 整段识别已删除。Windows x64 native addon 已列为精确版本的可选依赖；麦克风权限、真实推理速度和多显示器行为仍需 Windows 真机验证。本轮按要求不构建 Windows 安装包。

## Android

移动端首屏是提词画面，而非桌面控制台缩放版：

- 顶栏编辑稿件与显示设置。
- 底栏播放、AI、麦克风和前后段落。
- 稿件、镜像、字号、间距、行距、滚速使用底部抽屉。
- 直接复用 `PrompterSurface`，固定格式、镜像和 AI 锚点行为与桌面一致。

原生 `AndroidSpeechPlugin`：

- 仅在 API 31+ 且 `isOnDeviceRecognitionAvailable` 为真时启动。
- 使用 `createOnDeviceSpeechRecognizer`，不回退可能联网的默认识别服务。
- 申请 `RECORD_AUDIO`，输出 partial/final transcript、confidence、RMS level 与明确错误。
- final result、无匹配和超时后自动重新监听；销毁 Activity 时释放 recognizer。

Android Debug APK 已完成 Java、Manifest、资源和打包编译。当前 APK 尚未包含 FunASR GGUF/JNI；Android 的模型选择只有系统端侧语言包。后续加入 FunASR 必须先构建 Android NDK 原生库并在真机验证内存、温升和持续实时率，不能复用 Electron CLI 子进程。

## 构建

```bash
npm run build:desktop
npm run package:win
npm run build:android
```

Android 构建脚本优先读取 `JAVA_HOME`、`ANDROID_HOME` 和 `GRADLE_BIN`，并支持当前 Homebrew JDK 21、Android command-line tools 与 Gradle 8 路径。

## 未完成的真机验证

- Windows：麦克风权限、真实 FunASR 录音识别、CUDA/Vulkan/CPU 回退、多显示器与安装包。
- Android：系统端侧中文语言包、连续识别重启、真实麦克风响度、后台/锁屏行为、横竖屏和不同尺寸真机。
- Android FunASR：NDK/JNI、模型下载管理、ABI 分包、功耗与温升。
