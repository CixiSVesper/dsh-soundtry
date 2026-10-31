# 环境需求（Environment）

## 结论先行

> **本插件运行时借用本机 ComfyUI 的 Python 环境与 CUDA 环境。**
> 除这两样及其随附库之外，其余全部（代码、虚拟环境里的第三方包、模型权重）都打包在插件目录内。
> **因此本机不会出现第二份 Python、第二个 torch、第二套 CUDA 运行库。**

这不是"图省事"，是刻意的取舍：torch 2.8+cu129 安装后 7.2 GB、CUDA 运行库另算。插件要做的
音频理解只用到它里面极小一部分，复制一份收益为零、代价是 7 GB 与一次升级时的双份维护。

---

## 一、归属清单

| 组件 | 归属 | 位置 | 大小 |
|---|---|---|---|
| 插件代码（JS + Python CLI） | **自带** | `src/`、`python/` | < 200 KB |
| venv 内第三方包：`faster-whisper` `demucs` `torchcrepe` `resampy`（+ julius/lameenc/sphn） | **自带** | `runtime/venv/` | 108.2 MB |
| whisper large-v3 权重 | **自带** | `models/large-v3/` | 2948 MB |
| **Demucs htdemucs 权重** | **自带** | `models/torch/` | 80 MB |
| **ffmpeg**（`vendor/ffmpeg/ffmpeg.exe`） | **自带** | `vendor/ffmpeg/` | 61.5 MB |
| 分离缓存（按文件 hash，可随时删） | **自带** | `cache/stems/` | 每首约 30 MB |
| Python 3.12 解释器 | **借用 ComfyUI** | `<ComfyUI>/python/python.exe` | — |
| torch 2.8.0+cu129 / torchaudio | **借用 ComfyUI** | `<ComfyUI>/python/Lib/site-packages/torch` | 7203 MB |
| cuDNN 9 / cuBLAS 12（DLL） | **借用 ComfyUI** | 同上 `torch/lib` | — |
| **ctranslate2 / av** | **借用 ComfyUI** | 同上 site-packages | — |
| numpy / librosa / soundfile / scipy / onnxruntime | **借用 ComfyUI** | 同上 site-packages | — |

> **注意（实测更正）**：`ctranslate2` 和 `av` **不在** venv 里。建 venv 时用了
> `--system-site-packages`，`pip install` 看到 ComfyUI 已有这两个包就直接跳过了。
> 所以「自带」的只有 `faster-whisper / demucs / torchcrepe / resampy` 这几个。
> 复核命令：`runtime/venv/Scripts/python.exe -m pip list --local`。

**插件目录总计 ≈ 3.2 GB**：模型 3028 MB（whisper 2948 + demucs 80）+ venv 108 MB + ffmpeg 61.5 MB + 缓存。

---

## 二、借用是怎么实现的

```
<插件>/runtime/venv/pyvenv.cfg
    home = D:\ComfyUI\ComfyUI-aki-v2\python      ← 借用的入口，一行就是全部秘密
```

1. 插件内的 venv 是用 `--system-site-packages` 建的，所以它能 `import torch` 而不自带 torch；
2. 运行子进程前，把 `<ComfyUI>/python/Lib/site-packages/torch/lib` **前置到 PATH**，
   CTranslate2 才找得到 `cudnn64_9.dll` / `cublas64_12.dll`；
3. 这两个路径都是**运行时反查**出来的（读 `pyvenv.cfg` 的 `home`），不硬编码 —— ComfyUI 换了位置，
   只要重建 venv 就自动跟上。

验证命令（应输出 `borrow torch 2.8.0+cu129 cuda True`）：

```powershell
& "<插件>\runtime\venv\Scripts\python.exe" -c "import torch;print('borrow',torch.__version__,'cuda',torch.cuda.is_available())"
```

完整自检（本机实测 **11/11 就绪**）：

```powershell
& "<插件>\runtime\venv\Scripts\python.exe" "<插件>\python\soundtry.py" doctor
```

---

## 三、可以直接覆盖的配置

桌面端（Electron 宿主）**不继承 `setx` 设置的环境变量**，所以文件才是可靠入口。

`~/.dsh/soundtry.json`（按需，全部可选）：

```json
{
  "python":   "D:/ComfyUI/ComfyUI-aki-v2/python/python.exe",
  "comfyui":  "D:/ComfyUI/ComfyUI-aki-v2/python",
  "ffmpeg":   "C:/ffmpeg/bin/ffmpeg.exe",
  "device":   "cuda",
  "compute":  "float16",
  "prompt":   "开拓者, 绯英, 三月七",
  "extraPath": ["C:/Program Files/NVIDIA/CUDNN/v9/bin"]
}
```

| 键 | 作用 | 默认 |
|---|---|---|
| `python` | 用哪个解释器 | 插件内 `runtime/venv` |
| `comfyui` | CUDA 运行库所在的 ComfyUI python 目录 | 由 venv 反查 |
| `ffmpeg` | ffmpeg 路径 | `DSH_FFMPEG_PATH` → PATH → video-vision 自带 |
| `device` / `compute` | `cuda`+`float16` 或 `cpu`+`int8` | cuda / float16 |
| `prompt` | 识别偏置（人名、术语、一行歌词） | 无 |
| `extraPath` | 追加到子进程 PATH 的目录 | 空 |

对应的环境变量（优先级更高）：`SOUNDTRY_PYTHON`、`SOUNDTRY_CUDA_LIB`、`SOUNDTRY_FFMPEG`、
`SOUNDTRY_DEVICE`、`SOUNDTRY_COMPUTE`、`SOUNDTRY_PROMPT`。调试时设 `DSH_SOUNDTRY_DEBUG=1`。

---

## 四、想脱离 ComfyUI 完全独立？

两种做法，代价都写在括号里：

1. **只换 CUDA 运行库**：自己装 cuDNN 9 + cuBLAS 12，把 `comfyui` 指向包含它们的目录（+ 约 1 GB）。
   Python 包仍然借用。
2. **完全独立**：用系统 Python 建一个不借 site-packages 的 venv，自己装 torch（+ 约 7.2 GB），
   再把 `python` 指过去。除非你要在没装 ComfyUI 的机器上跑，否则不建议。

---

## 五、失败时怎么读报错

| 报错 | 原因 | 处理 |
|---|---|---|
| `找不到可用的 Python` | venv 被删 / ComfyUI 搬家 | 按报错里的第 3 条重建 venv |
| `Could not locate cudnn_ops64_9.dll` | CUDA 库没进 PATH | 设 `comfyui` 或 `SOUNDTRY_CUDA_LIB` |
| `音轨为空（这条视频可能没有音频流）` | DASH 分片下载 | `ffmpeg -i video -i audio -c copy out.mp4` |
| `找不到 ffmpeg` | 三处都没有 | 设 `ffmpeg` 或 `DSH_FFMPEG_PATH` |
| CUDA out of memory | 与 ComfyUI 抢显存 | `device: "cpu"` + `compute: "int8"`（结果逐字相同，约慢 12 倍） |

---

## 六、资源占用（实测）

| 模式 | 显存 | 4 分半的片子 | 14 分钟的片子 |
|---|---|---|---|
| GPU float16（默认） | 4.14 GB | 约 14 秒 | 约 65 秒 |
| GPU int8 | 2.26 GB | 约 17 秒 | — |
| CPU int8 | **0** | 约 2 分 53 秒 | — |

节奏与旋律分析是纯 CPU（librosa），显存 0，内存约 1–2 GB。
