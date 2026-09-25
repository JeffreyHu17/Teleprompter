# 实时跟稿 ASR 预选评估

## 产品约束

- 目标是判断朗读位置，不生成需要发布的最终字幕。
- 中文按读音对齐：同音字视为已读，声调不作为硬条件。
- 识别结果必须持续增量输出，不能等整句结束。
- 不做离线二次校正，避免句末修订造成画面回跳。
- 目标平台为 macOS、Windows 和 Android，全部离线运行。

## 候选结论

| 候选 | 流式机制 | 本地部署 | 跟稿适配性 | 当前结论 |
| --- | --- | --- | --- | --- |
| FunASR Paraformer-zh-streaming | 复用跨块 cache 的原生流式解码 | sherpa-onnx CPU 已接入 macOS/Windows | 高 | 已实现的桌面默认 |
| Qwen3-ASR-0.6B 官方流式 | vLLM 下累计音频重解码，默认 2 秒块并回滚尾部 token | 官方流式仅 vLLM；偏 CUDA/Linux | 中 | 高性能桌面预选 |
| Qwen3-ASR-0.6B INT8 ONNX | sherpa-onnx 可覆盖桌面和移动端 | 可运行于 macOS、Windows、Android、iOS | 中低 | 仅模拟流式实验候选 |
| SenseVoiceSmall GGUF | 静音分段后的非流式 CLI | 已从产品删除 | 低 | 仅保留历史调研结论 |

## Qwen3-ASR 流式分析

Qwen3-ASR 提供 0.6B 和 1.7B 两档，支持普通话、粤语、多种中文方言及多语言，识别质量和稿件 `context` 是明显优势。0.6B 原始权重约 1.88GB，端侧成本明显高于流式 Paraformer。

官方流式实现存在以下边界：

1. 当前只支持 vLLM backend，不支持 Transformers backend 流式调用。
2. `init_streaming_state` 默认 `chunk_size_sec=2.0`；官方 Web Demo 默认 1 秒。
3. 每次新块到达后会重新输入截至当前的全部音频，不是只消费新块的声学缓存。
4. 使用 `unfixed_token_num` 回滚尾部 token，因此最新几个字符是不稳定结果，必须经过稳定前缀门控后才能移动画面。
5. 流式模式不返回时间戳。
6. vLLM 原生 Windows 不受支持；Apple Silicon GPU 依赖社区维护的 vLLM-Metal。Android 没有官方 vLLM 路径。

sherpa-onnx 已提供 Qwen3-ASR-0.6B INT8 ONNX 和 Android 示例，但其移动端方案属于“使用非流式模型模拟实时识别”，不能等同于官方 vLLM 流式实现。

## 跟稿匹配要求

无论选择哪个 ASR，都必须经过独立的读音对齐层：

1. 将稿件和 ASR 增量结果转换成带上下文消歧的拼音音节。
2. 初次定位至少需要连续 4-6 个音节；锁定后允许一个稳定音节推进一个汉字。
3. 相同汉字得分最高，同拼音忽略声调视为匹配，近似声母或韵母给予较低分。
4. 只在当前锚点附近前向搜索；重读回跳扩大后向窗口并要求连续确认。
5. 不稳定尾部只用于候选位置，不能提交到显示锚点。

以上对齐层已经实现：中文采用 `pinyin-pro` 上下文拼音与多音字候选，英文连续字母作为一个词，不再按字母移动。首次定位最少 4 个 token，锁定后允许单音节推进；向后重读至少需要 4 个 token 并经过确认。

## Qwen3-ASR 验收门槛

Qwen3-ASR 只有同时满足以下条件才从预选升级为可用模型：

- 单路连续朗读 20 分钟不出现计算量随音频长度失控。
- 首个可提交中文音节延迟不高于 800ms，稳定运行时更新间隔不高于 600ms。
- macOS Apple Silicon、Windows NVIDIA 和 Android 真机分别记录实时率、峰值内存、温升和耗电。
- 末尾 token 回滚不会导致锚点抖动或错误回跳。
- 导入稿件作为 `context` 后，专有名词准确率提升且不会照抄未朗读内容。

## 资料

- [Qwen3-ASR 官方仓库](https://github.com/QwenLM/Qwen3-ASR)
- [Qwen3-ASR 官方流式实现](https://github.com/QwenLM/Qwen3-ASR/blob/main/qwen_asr/inference/qwen3_asr.py)
- [Qwen3-ASR 0.6B 权重](https://huggingface.co/Qwen/Qwen3-ASR-0.6B)
- [sherpa-onnx Qwen3-ASR 跨平台说明](https://k2-fsa.github.io/sherpa/onnx/qwen3-asr/index.html)
- [sherpa-onnx Android 模拟流式说明](https://k2-fsa.github.io/sherpa/onnx/android/apk-simulate-streaming-asr-cn.html)
