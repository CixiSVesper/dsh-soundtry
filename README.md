# dsh-soundtry

**让 DSH 听得见声音** —— 本地转录、测节奏、抽旋律，全部离线、零 API 费用。

和 `dsh-video-vision`（看得见画面）配套使用：那个负责"是什么样"，这个负责"说了什么、什么节奏、旋律往哪走"。

## 四个工具

| 工具 | 干什么 | 什么时候用 |
|---|---|---|
| `sound_read` | 一次给全：逐句时间码 + BPM/切点对位 + 人声旋律 + 和弦 | 想快速搞清"这条视频在说什么、什么调、什么和弦" |
| `sound_transcribe` | 语音/歌词 → 带时间码文本，可写 SRT，可切窗口 | 要字幕、要引用台词、要确认有没有旁白 |
| `sound_rhythm` | BPM（网格回套+相位连续性+偶奇拍判据）、鼓组能量、切点踩拍率 | 判断"是不是跟着音乐剪的""为什么这段更急" |
| `sound_melody` | **人声轨**上的音域、调性、最常出现的音、指定窗口的音高轮廓 | 判断副歌有没有升、句子跳了几度 |
| `sound_chords` | 缓和过的和弦时间轴（拍点级），含各和弦持续时长 | 判断四和弦循环、副歌换不换和弦、预副歌在哪抬起来 |

典型调用：

```
sound_read      input="D:/片子.mp4"
sound_chords    input="D:/歌.flac"
sound_rhythm    input="D:/歌.mp4" video="D:/歌.mp4"
sound_transcribe input="D:/课.mp4" start=600 end=720 srt="D:/课_10min.srt"
sound_melody    input="D:/歌.mp4" windows=["副歌:78:82","主歌:33:37"]
```

## 怎么做到"不编词"的

whisper 在没人声的地方会**主动编**：演职员表、"点赞订阅"、字幕组——这些句子长度和语速都完全正常，
靠长度/语速判据抓不住。这里的做法是**从源头堵**：

1. Demucs 拆出人声轨；
2. 在人声轨上按能量找人声区间（阈值取 P90 的 25%，抗得住主歌小声/副歌大声）；
3. 把邻近区间**合并成 30 秒量级的块**（切太碎会让 whisper 失去上下文，"暧昧告诉我不能这样"会变成"美国是我本人最爱"）；
4. 只把这些块送进 whisper —— 前奏、间奏、尾奏根本不参与识别，**没有机会编**；
5. 剩下两道兜底：已知幻觉词表 + 逐秒人声占比。

实测同一首 252 秒的歌：整条转写会编 1 段"点赞订阅"；切分后 **0 段幻觉**，歌词质量不变。

## 环境：借用 ComfyUI，不重复安装

**这是本插件最重要的一条设计，详见 [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)。**

一句话：**除了 ComfyUI 已经装好的 Python 与 CUDA，其余全部打包在插件目录里。**

| 来源 | 内容 |
|---|---|
| 插件自带（在 `runtime/`、`models/`） | faster-whisper、ctranslate2、av、whisper large-v3 权重 |
| **借用本机 ComfyUI** | Python 3.12 解释器、torch 2.8+cu129、cuDNN 9 / cuBLAS 12、numpy、librosa、soundfile |
| 借用第三个 | ffmpeg（优先用 `dsh-video-vision` 里那份） |

所以本机不会出现第二个 torch、第二个 Python、第二份 CUDA。想换成独立环境，改一个配置项即可。

## 磁盘占用

| 项 | 大小 |
|---|---|
| 代码（`src/` `python/` `docs/`） | < 150 KB |
| 插件内 venv（faster-whisper / ctranslate2 / av / demucs / torchcrepe） | 108.2 MB |
| whisper large-v3 权重 | 2948 MB |
| Demucs htdemucs 权重 | 80 MB |
| **合计** | **≈ 3.14 GB**（96% 是模型） |

换小模型（`model: "medium"` 或 `"small"`）可降到 1.5 GB / 0.5 GB，代价是准确率。
`cache/stems/` 是分离缓存（每首约 30 MB），随时可删。

## 自检

```powershell
& "<插件>\runtime\venv\Scripts\python.exe" "<插件>\python\soundtry.py" doctor
```

本机实测 **14/14 项就绪**（Python / numpy / soundfile / librosa / faster-whisper / ctranslate2 /
demucs / torchcrepe / torchaudio / torch（借用）/ GPU / CUDA 设备 / ffmpeg（借用）/ 模型）。

## 命令行契约（改代码前必读）

python 侧的 `input` 是**位置参数**，不是 `--input`：

```
python/soundtry.py transcribe <path> --head 20 --vad-mode vocals
```

`src/tools.js` 的 `toArgs()` 必须先把 `input` 作为位置参数塞进 argv、再追加 flag。
**这个不一致曾经让五个工具同时挂掉**（argparse 把路径当位置参数吃掉，只剩孤儿 `--input` 报
`unrecognized arguments`）。

现在两侧都有保护：`toArgs` 正确处理位置参数；`soundtry.py` 的 `main()` 在解析前会把
`--input <path>` 重写成位置参数，所以旧调用方也不会挂。改任何一侧都要跑一遍"走真实工具路径"的
回归（`spec.execute()`，不要只测 `runner.runSoundtry()`——那是绕过 `toArgs` 的）。

## 已知局限（别指望它替你做判断）

1. **和弦品质不可靠。** 根音与和声节奏稳（"四和弦循环""副歌换不换和弦"能答），但 maj / maj7 / m7
   之间会混，把 `C#maj7` 和 `C#m7` 当同一个东西看。手写模板、没有训练过的模型（essentia 缺
   Windows 轮子、madmom 只发源码包），帧准确率约 60–75%。
2. **唱词仍有错字。** 分离 + 分块把"暧昧告诉我不能这样"救回来了，但"迷不残响""混乱枪"这类还是错。
   **最有效的补法是把真歌词塞进 `prompt`** —— 模型会照着对齐。
3. **没有小节线与曲式分段。** 只有恒定 BPM 网格 + 相位，答不了"副歌从第几小节进"。
4. **听不出好坏。** 能说"副歌比主歌高了三度半"，说不出"这个上行是不是该有那种酸"。
5. **没有音频流的文件会直接报错。** B 站的 DASH 下载是音视频分开的，需要先
   `ffmpeg -i video -i audio -c copy out.mp4`。
6. **有冷启动。** whisper 加载约 3 秒、Demucs 加载约 3 秒；分离一首 4 分钟的歌约 25 秒
   （按文件缓存，同一文件第二次调用直接命中）。

## 卸载

从 profile 的 `dsh.profile.bundles` 移除 `dsh-soundtry`，删掉本目录即可 —— 它没有在系统里注册任何东西。
