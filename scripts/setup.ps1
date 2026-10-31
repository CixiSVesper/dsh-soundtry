# 从零安装 DSH-SoundTry（新机器 / 新克隆）
# 用法：
#   .\scripts\setup.ps1 -Python "D:\ComfyUI\ComfyUI-aki-v2\python\python.exe"
# 可选：
#   -Ffmpeg "C:\path\to\ffmpeg.exe"   不传则尝试 PATH
#   -Mirror  "https://pypi.tuna.tsinghua.edu.cn/simple"
param(
  [Parameter(Mandatory = $true)][string]$Python,
  [string]$Ffmpeg = "",
  [string]$Mirror = "https://pypi.tuna.tsinghua.edu.cn/simple"
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
function Say($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }

Say "== DSH-SoundTry 安装 ==" Cyan
Say "插件目录: $root"

if (-not (Test-Path $Python)) { throw "找不到 Python: $Python" }
Say "`n[1/5] 检查这个 Python 是否带 torch / torchaudio / librosa" Yellow
& $Python -c "import torch, torchaudio, librosa, soundfile, numpy; print('  torch', torch.__version__, 'cuda', torch.cuda.is_available())"
if ($LASTEXITCODE -ne 0) { throw "这个 Python 缺 torch/torchaudio/librosa —— 换一个装了这些的解释器（例如 ComfyUI 自带的那个）" }

Say "`n[2/5] 建 venv（--system-site-packages，让 torch 继续从外面借，不复制 7 GB）" Yellow
if (Test-Path "runtime\venv") { Say "  已存在，跳过" DarkGray }
else { & $Python -m venv --system-site-packages runtime\venv }

$py = Join-Path $root "runtime\venv\Scripts\python.exe"
Say "`n[3/5] 安装插件自带的包（faster-whisper / demucs / torchcrepe）" Yellow
& $py -m pip install -q --upgrade pip -i $Mirror
& $py -m pip install -q "faster-whisper>=1.0" "demucs>=4.0" "torchcrepe>=0.0.23" -i $Mirror
& $py -m pip list --local --disable-pip-version-check

Say "`n[4/5] 下载 whisper large-v3 权重（约 2.9 GB，来自 ModelScope）" Yellow
$md = Join-Path $root "models\large-v3"
New-Item -ItemType Directory -Force -Path $md | Out-Null
$base = "https://www.modelscope.cn/models/pengzhendong/faster-whisper-large-v3/resolve/master"
foreach ($f in @("config.json", "model.bin", "tokenizer.json", "vocabulary.txt", "preprocessor_config.json")) {
  $dst = Join-Path $md $f
  if (Test-Path $dst) { Say "  $f 已存在" DarkGray; continue }
  Say "  下载 $f …"
  & curl.exe -L --ssl-no-revoke --retry 3 -o $dst "$base/$f"
  if ($LASTEXITCODE -ne 0) { throw "下载失败: $f" }
}

Say "`n[5/5] 准备 ffmpeg" Yellow
$vd = Join-Path $root "vendor\ffmpeg"
New-Item -ItemType Directory -Force -Path $vd | Out-Null
$target = Join-Path $vd "ffmpeg.exe"
if (Test-Path $target) { Say "  已存在" DarkGray }
elseif ($Ffmpeg -and (Test-Path $Ffmpeg)) { Copy-Item $Ffmpeg $target; Say "  已从 $Ffmpeg 复制" }
else {
  $onPath = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($onPath) { Copy-Item $onPath.Source $target; Say "  已从 PATH 复制" }
  else { Say "  ⚠ 没找到 ffmpeg。请重新运行并传 -Ffmpeg <路径>，或把 ffmpeg.exe 放进 vendor\ffmpeg\" DarkYellow }
}

Say "`n== 自检 ==" Cyan
& $py (Join-Path $root "python\soundtry.py") doctor
Say "`n完成。Demucs 的 htdemucs 权重（约 80 MB）会在第一次分离时自动下载到 models\torch\" Green
