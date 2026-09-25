# 提词器控制窗口、镜像显示与手动操作调研

## 1. 结论摘要

用户提出的产品形态符合专业提词器的常见工作流：

- **控制窗口**由操作员使用，负责导入稿件、编辑、排版、播放状态、速度、AI 状态、定位和应急操作。
- **显示窗口**只负责把稿件输出到提词器屏幕，可全屏、水平镜像、垂直镜像或旋转 180 度。
- 两个窗口共享同一份会话状态，但不共享窗口布局；显示端必须按自己的实际分辨率排版。
- AI 跟随和手动操作不是两套独立播放器，必须通过同一命令总线修改同一个稿件锚点。
- 稿件位置的权威表示应为 `字符偏移 + 段落 ID + 段内偏移`，不能是页码或像素滚动值。

现有项目已经验证主要需求：

| 项目 | 可参考能力 | 主要限制 |
| --- | --- | --- |
| [Eyevinn Open Teleprompter](https://github.com/Eyevinn/teleprompter) | 控制端/显示端分离、WebSocket 同步、多显示器、镜像、DOCX/TXT | 更接近 Web/服务器架构，AI 跟随不是重点 |
| [Textream](https://github.com/f/textream) | 指定外接屏、水平/垂直/双轴镜像、远程控制、实时位置同步、字体设置 | macOS 专用 |
| [Imaginary Teleprompter](https://imaginarysense.github.io/Imaginary-Teleprompter/) | 一端镜像、一端监看、标记跳转、速度和字体快捷键 | 较旧，不能直接作为跨平台底座 |
| [QPrompt](https://github.com/Cuperino/QPrompt-Teleprompter) | Qt/QML 跨桌面与 Android、成熟提词器编辑和控制思路 | GPLv3，iOS 覆盖不足 |
| [Cuevora](https://github.com/iclectic/Cuevora) | 镜像、焦点线、字号/行距、平滑滚动、移动端交互 | 控制/显示分离不是核心 |

## 2. 典型使用拓扑

需要支持三种部署方式，并共享同一业务协议。

### 2.1 同一台桌面设备，两个显示器

```text
主显示器：控制窗口
外接显示器：无边框全屏显示窗口 -> 提词器反光玻璃
```

这是 Windows/macOS 首要场景。控制端可以选择目标显示器，并记住设备标识、分辨率、方向和镜像设置。

### 2.2 手机或平板本机作为提词器屏幕

```text
手机/平板：全屏显示
蓝牙键盘、翻页器或触控浮层：手动控制
设备麦克风：AI 跟随
```

设备只有一个屏幕时，控制窗口和显示窗口是不同页面/模式，而不是同时可见的两个窗口。播放前完成设置，播放中通过隐藏工具栏或外部控制器操作。

### 2.3 一台设备控制，另一台设备显示

```text
控制设备 <- 本地局域网/USB -> 显示设备
```

该方式适用于电脑控制 iPad/Android 平板。它不是首版硬依赖，但协议应提前支持：

- 全程本地网络，不经过云服务。
- 二维码或短码配对。
- 明确的控制端和只读显示端角色。
- 状态版本、心跳、断线重连和完整快照恢复。
- 后续评估 USB 有线通道，首版可以局域网 WebSocket 起步。

## 3. 平台实现调研

| 平台 | 建议实现 | 需要验证 |
| --- | --- | --- |
| Windows | 原生多窗口 + Windows App SDK `DisplayArea` 枚举和放置 | 多 DPI、显示器热插拔、窗口跨屏、全屏恢复 |
| macOS | 原生多窗口 + `NSScreen` 目标屏选择 | Space/全屏行为、屏幕录制隐藏、Sidecar |
| Android | 主 Activity + `DisplayManager`/`Presentation` 输出第二屏 | HDMI、USB-C、无线显示、厂商桌面模式、热插拔 |
| iOS/iPadOS | UIKit Scene + external noninteractive display scene | AirPlay/USB-C、设备镜像与扩展模式、不同系统版本 |
| 单屏移动端 | Flutter 页面切换为全屏显示模式 | 屏幕常亮、方向锁定、通知遮挡、手势误触 |

Android 官方提供 `DISPLAY_CATEGORY_PRESENTATION` 和 `Presentation`；Apple 平台通过外接显示 Scene 输出与主界面不同的内容；Windows 可枚举 `DisplayArea`。因此跨平台业务层可以共用，但外接显示适配必须是平台原生模块。

## 4. 控制窗口需求

### 4.1 稿件导入与编辑

第一阶段支持：

- 直接粘贴文本。
- `.txt`，自动识别 UTF-8/UTF-16，不能静默乱码。
- `.md`，保留段落、标题和强调语义，显示端默认不渲染 Markdown 符号。
- `.docx`，提取正文、段落和基础粗体/斜体；复杂表格、图片和浮动文本需给出降级提示。

后续候选：

- `.pptx` 演讲者备注。
- PDF 只做显式文本提取，不把 PDF 页面截图直接当提词稿。
- 稿件标记，如 `[停顿]`、`[看镜头]`，允许显示但从 ASR 匹配文本中排除。

导入后生成稳定结构：

```text
Document
  -> Section
    -> Paragraph(id, sourceRange, plainText, styleRuns)
      -> Token/Character Anchors
```

不能直接以编辑器生成的 HTML DOM 节点作为稿件位置标识，否则编辑、字体变化和跨平台渲染会破坏定位。

### 4.2 控制端工作区

控制窗口建议包含：

- 稿件编辑器和段落导航。
- 当前段、下一段以及显示端实际画面的正常方向预览。
- 播放/暂停、停止、前后翻页、前后段落和回到指定位置。
- AI/定速/混合模式切换及麦克风、ASR 模型、置信度和跟踪状态。
- 速度、字体、字号、字重、行距、段距、文本宽度、焦点线位置和颜色。
- 目标显示器、分辨率、旋转、水平/垂直镜像和全屏设置。
- 连接状态、帧率、最后同步时间和显示端实际应用的状态版本。
- 应急黑屏、冻结画面、重发完整状态和关闭显示窗口。

### 4.3 现场修改

- 播放中允许调整字号、行距、边距和速度。
- 字体变化后必须基于稿件锚点重新排版并保持当前句，不能保持旧像素位置。
- 编辑已读文本时默认警告；编辑未读文本后重新建立索引。
- 操作员可以单击任意段落使 AI 跟踪器重新锚定到该位置。

## 5. 显示窗口需求

显示窗口应尽量简单、确定且不接受文本编辑：

- 无边框全屏，可选择目标显示器。
- 默认黑底白字，并提供高对比度颜色。
- 水平镜像、垂直镜像、双轴镜像/180 度旋转。
- 镜像只作用于显示输出，不作用于控制窗口。
- 支持安全边距、文本列宽、字号、字重、字体、行距、段距和对齐方式。
- 支持焦点线或阅读区域，位置与透明度可调。
- 隐藏鼠标指针、系统工具栏和非必要通知。
- 可选倒计时、录制状态、页码/进度；所有提示都必须经过相同镜像变换。
- 显示端断线时默认冻结最后一帧并显示低干扰连接标志，不能清空成白屏。

### 5.1 镜像定义

| 模式 | 变换 | 用途 |
| --- | --- | --- |
| 正常 | 无 | 直接看屏幕 |
| 水平镜像 | `scaleX(-1)` | 常见分光镜提词器 |
| 垂直镜像 | `scaleY(-1)` | 特殊安装方向 |
| 双轴/旋转 | `scaleX(-1) scaleY(-1)` 或 180 度 | 倒置安装 |

必须用实物玻璃验证方向，不能只看软件截图。镜像后还要检查字形抗锯齿、焦点线、边距和滚动方向是否符合读者看到的反射结果。

## 6. 字体与排版调研

### 6.1 第一阶段控制项

- 字体族：系统无衬线、系统衬线、等宽字体及用户可选字体。
- 字号：连续范围和常用预设。
- 字重：至少 400/500/600/700；实际可用值取决于字体文件。
- 行距、段距、字色、背景色。
- 左/中/右对齐。
- 文本列宽和左右安全边距。
- 当前句/已读/未读颜色及高亮方式。

### 6.2 跨设备字体问题

- 控制设备和显示设备可能没有同一字体。
- 显示端必须回报最终解析到的字体及排版结果。
- 页面边界只能由显示端实际布局决定，控制端预览不能作为权威分页。
- 若需要跨设备完全一致，应随应用提供有明确再分发许可的中文字体，或在配对时传输允许分发的字体资源。
- 中文字体文件较大，必须单独评估初始包体、按需下载和许可证。

## 7. 分页与滚动模型

### 7.1 权威位置

```text
ScriptAnchor {
  documentRevision,
  paragraphId,
  charOffsetInParagraph,
  globalNormalizedCharOffset
}
```

页码、行号和像素滚动量都是显示派生值。字体、字号、窗口尺寸或方向变化后：

1. 显示端重新排版。
2. 用 `ScriptAnchor` 找到当前句。
3. 把当前句恢复到焦点线。
4. 返回新的 `pageIndex/pageCount/layoutRevision` 给控制端。

### 7.2 两种显示模式

- **连续滚动**：文本以速度或 AI 位置平滑移动，页只是导航概念。
- **分页模式**：显示固定页面，达到提交阈值后整页或带过渡翻页。

两者应共用稿件锚点和手动导航命令。用户请求的左右键“翻页”在连续滚动模式中定义为跳过一个视口，而不是依赖物理纸页。

## 8. 手动快捷键调研

### 8.1 用户提出的映射

| 输入 | 用户期望 | 建议命令语义 |
| --- | --- | --- |
| `Space` | 播放 | `togglePlayPause` |
| `Left` | 向前一页 | `previousPage` |
| `Right` | 向后一页 | `nextPage` |
| `Shift+Left` | 向前一段 | `previousParagraph` |
| `Shift+Right` | 向后一段 | `nextParagraph` |
| `Up` | 加速 | `adjustSpeed(+step)` |
| `Down` | 减速 | `adjustSpeed(-step)` |
| 单按 `Enter` | 播放 | `togglePlayPause` |
| 双按 `Enter` | 向上滚动 | `rewindStep` 或 `reverseScroll`，需进一步定义 |

该方案可以实现，但应采用**可配置快捷键配置文件**，不能写死。原因包括：

- 不同提词器/翻页器会发送 Space、Enter、PageUp/PageDown 或媒体键。
- macOS、Windows 和移动端外接键盘的系统保留组合不同。
- 操作员可能习惯左右键控制速度，而不是翻页。
- AI 模式下“速度”可能是视觉追赶速度；定速模式下才是实际阅读速度。

### 8.2 双按 Enter 的问题

识别单按和双按是互斥判定：

- 等待第二次输入再执行单按，会给播放增加约 200-300ms 延迟。
- 第一次立即播放，第二次再撤销并回滚，会造成短暂启停、ASR 状态变化和画面抖动。

因此建议：

1. 默认方案使用无歧义按键，例如 `Enter = 播放/暂停`、`PageUp = 向上滚动一步`。
2. 提供“用户建议方案”预设，允许双按 Enter 回滚，并可调双按时间窗。
3. 若保留双按，可进一步支持“双按并按住第二次 Enter”进入连续反向滚动，松开即停止；该交互必须真机盲测。

### 8.3 建议默认键位

| 命令 | 默认键位 | 备用键位 |
| --- | --- | --- |
| 播放/暂停 | `Space` | `Enter` |
| 上一页/下一页 | `Left` / `Right` | `PageUp` / `PageDown` |
| 上一段/下一段 | `Shift+Left` / `Shift+Right` | 可自定义 |
| 加速/减速 | `Up` / `Down` | 鼠标滚轮或控制器轴 |
| 向上/向下滚动一步 | `PageUp` / `PageDown` | 可自定义 |
| 连续反向滚动 | 按住 `PageUp` | 控制器反向轴 |
| 停止并保持当前位置 | `Esc` | 可自定义 |
| 紧急黑屏 | 可配置，默认不占常用键 | 控制窗口按钮 |

不要把 `Esc` 定义为清空或回到开头，避免现场误触造成不可恢复的位置丢失。

## 9. AI 与手动控制的协同

所有输入都转换为语义命令：

```text
Keyboard / Mouse / Touch / Bluetooth Remote / AI Tracker
  -> Command Bus
  -> Session Reducer
  -> Versioned State
  -> Controller Preview + Prompter Display
```

### 9.1 优先级

1. 操作员的明确定位命令最高优先级。
2. 用户手动跳页/跳段后，立即更新 AI 跟踪锚点。
3. 在可配置的 1-3 秒保护期内，AI 只能在新锚点附近匹配，不能把画面拉回旧位置。
4. 保护期后，AI 依据新朗读内容继续双向跟踪。
5. AI 置信度不足时保持画面，不覆盖手动位置。

### 9.2 不同模式下的速度

| 模式 | 加速/减速含义 |
| --- | --- |
| 定速模式 | 改变实际滚动速度/WPM |
| AI 跟随模式 | 改变画面追赶速度和平滑程度，不改变识别位置 |
| 混合模式 | 改变无可靠识别时的基础速度和识别恢复后的追赶速度 |

控制窗口必须明确显示当前模式，防止操作员按了加速却误以为 ASR 灵敏度发生变化。

## 10. 状态同步协议

建议控制端持有权威会话状态，显示端是确定性渲染器：

```text
SessionState {
  sessionId,
  documentRevision,
  stateRevision,
  playbackMode,
  playState,
  scriptAnchor,
  speed,
  typography,
  mirrorTransform,
  targetDisplay,
  focusLine,
  trackerStatus
}
```

协议至少需要：

- `loadDocument`
- `applySnapshot`
- `play` / `pause` / `stop`
- `seekToAnchor`
- `nextPage` / `previousPage`
- `nextParagraph` / `previousParagraph`
- `adjustSpeed`
- `setTypography`
- `setMirrorTransform`
- `layoutReport`
- `heartbeat` / `resyncRequest`

每条命令携带 `commandId` 和预期 `stateRevision`，防止按键连发、网络重发或 AI 事件造成重复翻页。

同一进程的两个窗口优先走内存状态总线；跨设备时复用同一语义协议，传输层换成本地 WebSocket。不要让同机双窗口也依赖一个必须常驻的 Node.js 服务。

## 11. 调研与验证计划

### Phase A：竞品行为验证

- 实际运行 Eyevinn、Textream、Imaginary Teleprompter 和 QPrompt 中至少三个。
- 记录控制/显示职责、镜像方向、字体变化后的定位和快捷键行为。
- 使用真实分光镜确认源画面与反射画面方向。

### Phase B：跨平台显示技术原型

- Windows/macOS：创建控制窗口和目标屏全屏显示窗口。
- Android：用 `Presentation` 输出独立显示内容。
- iOS/iPadOS：创建外接显示 Scene。
- 验证 HDMI/USB-C、AirPlay/无线显示、Sidecar 和屏幕热插拔。

### Phase C：排版与锚点原型

- 导入同一份包含中文、英文、数字和长段落的稿件。
- 循环调整字体、字号、字重、行距、窗口尺寸和方向。
- 验证当前句始终回到焦点线，AI 锚点不随分页变化。
- 比较控制端预览和显示端实际布局差异。

### Phase D：快捷键可用性测试

- 测试键盘、数字小键盘、蓝牙翻页器和至少一种专业 Shuttle 控制器。
- 测试按键长按、系统自动连发、焦点丢失和输入法状态。
- 对比无歧义默认方案与双按 Enter 方案的响应时间和误操作率。
- 在 AI 跟随期间手动跳页/跳段，验证保护期和重新锚定。

### Phase E：故障与现场压力测试

- 显示器拔插、分辨率改变和方向旋转。
- 控制窗口崩溃/重启后的显示冻结和会话恢复。
- 局域网断开、延迟和重复命令。
- ASR 丢失位置时的手动接管。
- 45 分钟持续滚动的帧率、内存和字体渲染稳定性。

## 12. 验收指标

| 指标 | 目标 |
| --- | --- |
| 控制命令到显示生效 P95，同机 | `<= 50ms` |
| 控制命令到显示生效 P95，局域网 | `<= 150ms` |
| 连续滚动帧率 | 目标屏刷新率下无明显卡顿，至少稳定 60fps |
| 字体/字号变化后当前位置保持 | 100% 回到同一语义锚点 |
| 手动翻页后 AI 错误拉回 | 0 次/10 分钟测试 |
| 按键连发导致重复翻页 | 0 次 |
| 显示热插拔恢复 | 不丢稿件位置，10 秒内恢复 |
| 水平镜像实物验证 | 源屏反字，玻璃中正字且滚动方向正确 |
| 45 分钟持续运行 | 无崩溃、无明显漂移、无不可恢复断连 |

## 13. 建议冻结的产品决策

以下决策可以直接作为后续原型前提：

1. 控制窗口和显示窗口分离。
2. 稿件锚点是权威位置，页码和像素位置不是。
3. 显示端负责最终排版并回报布局。
4. 镜像只作用于显示输出。
5. AI 和所有手动输入走同一命令/状态系统。
6. 快捷键可配置，并提供“标准”和“用户建议”两个预设。
7. 双按 Enter 回滚先进入可用性实验，不设为唯一默认行为。
8. 跨设备控制只走本地连接，不依赖云服务。

## 14. 尚需产品确认的问题

- 用户所说的“双按回车向上滚动”是向上滚动固定行数、一个视口，还是双按后连续反向滚动？
- 左右键的“翻页”在连续滚动模式下希望跳一个视口，还是跳到人工分页标记？
- 第一版是否必须支持电脑控制独立的 iPad/Android 设备，还是只需支持同机外接屏？
- 是否需要操作员在播放期间实时编辑未读稿件？
- 是否需要同时驱动多个镜像显示窗口？
- 字体是否允许导入第三方 `.ttf/.otf`，以及产品是否接受相应字体许可证责任提示？

这些问题不阻塞基础架构原型，但会影响默认交互和首版范围。

## 15. 官方资料入口

- Android secondary display：<https://developer.android.com/reference/android/app/Presentation.html>
- Android DisplayManager：<https://developer.android.com/reference/android/hardware/display/DisplayManager.html>
- Apple external display：<https://developer.apple.com/documentation/uikit/presenting-content-on-a-connected-display>
- Windows DisplayArea：<https://learn.microsoft.com/windows/windows-app-sdk/api/winrt/microsoft.ui.windowing.displayarea>
- Eyevinn Open Teleprompter：<https://github.com/Eyevinn/teleprompter>
- Textream：<https://github.com/f/textream>
- QPrompt：<https://github.com/Cuperino/QPrompt-Teleprompter>
- Imaginary Teleprompter：<https://imaginarysense.github.io/Imaginary-Teleprompter/>
