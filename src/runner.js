/**
 * runner.js — 找到"借来的" Python / CUDA，跑 python/soundtry.py，取回结果。
 *
 * 两条原则：
 *   1. 不复制 ComfyUI 的任何东西。默认直接用它那个 python（通过本插件 venv 的
 *      pyvenv.cfg 反查出 home），CUDA 运行库则把它的 torch/lib 加进子进程 PATH。
 *   2. 找不到就说清楚缺哪一环、怎么改，而不是抛一个 spawn ENOENT。
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = resolve(HERE, '..');
const VENV_PY = join(PLUGIN_ROOT, 'runtime', 'venv', 'Scripts', 'python.exe');
const SCRIPT = join(PLUGIN_ROOT, 'python', 'soundtry.py');
const JSON_MARK = '@@JSON@@';

function homeDir(env = process.env) {
  return env.DSH_HOME?.trim() || join(homedir(), '.dsh');
}

/** ~/.dsh/soundtry.json —— 桌面端不继承 setx，所以文件才是可靠入口。 */
export function loadConfig(env = process.env) {
  const out = { python: '', comfyui: '', ffmpeg: '', device: '', compute: '', prompt: '', extraPath: [] };
  try {
    const raw = JSON.parse(readFileSync(join(homeDir(env), 'soundtry.json'), 'utf8'));
    for (const k of Object.keys(out)) {
      if (raw?.[k] !== undefined) out[k] = raw[k];
    }
  } catch { /* 没配置文件是常态 */ }
  return out;
}

/** 从 venv 的 pyvenv.cfg 反查基础解释器所在目录（也就是 ComfyUI 的 python 目录）。 */
function venvBase(venvPy) {
  try {
    const cfg = readFileSync(join(dirname(venvPy), '..', 'pyvenv.cfg'), 'utf8');
    const m = /^home\s*=\s*(.+)$/m.exec(cfg);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

export function resolvePython(env = process.env, cfg = loadConfig(env)) {
  const cands = [
    env.SOUNDTRY_PYTHON,
    cfg.python,
    VENV_PY,
  ].filter(Boolean);
  for (const c of cands) {
    if (existsSync(c)) return c;
  }
  const hint = [
    '找不到可用的 Python。三种改法（优先级从高到低）：',
    `  1. 设环境变量 SOUNDTRY_PYTHON=<python.exe 全路径>`,
    `  2. 写 ${join(homeDir(env), 'soundtry.json')}：{"python": "C:\\\\...\\\\python.exe"}`,
    `  3. 重建插件内的 venv：<ComfyUI>\\python\\python.exe -m venv --system-site-packages "${join(PLUGIN_ROOT, 'runtime', 'venv')}"`,
  ].join('\n');
  throw new Error(hint);
}

/** CUDA 运行库（cuDNN 9 / cuBLAS 12）在哪：优先配置，其次从 venv 反查 ComfyUI，最后看常见位置。 */
export function resolveCudaLib(env = process.env, cfg = loadConfig(env)) {
  const tried = [];
  const push = (p) => {
    if (!p) return null;
    tried.push(p);
    return existsSync(p) ? p : null;
  };
  let hit = push(env.SOUNDTRY_CUDA_LIB);
  if (hit) return hit;
  hit = push(cfg.comfyui ? join(cfg.comfyui, 'Lib', 'site-packages', 'torch', 'lib') : null);
  if (hit) return hit;

  const base = venvBase(resolvePython(env, cfg));
  if (base) {
    hit = push(join(base, 'Lib', 'site-packages', 'torch', 'lib'));
    if (hit) return hit;
  }
  for (const guess of [
    'D:/ComfyUI/ComfyUI-aki-v2/python/Lib/site-packages/torch/lib',
    'C:/ComfyUI/ComfyUI-aki-v2/python/Lib/site-packages/torch/lib',
  ]) {
    hit = push(guess);
    if (hit) return hit;
  }
  return null;
}

export function environmentReport(env = process.env) {
  const cfg = loadConfig(env);
  let python = null;
  let error = null;
  try {
    python = resolvePython(env, cfg);
  } catch (e) {
    error = e.message;
  }
  return {
    python,
    pythonSource: python === env.SOUNDTRY_PYTHON ? 'env'
      : python === cfg.python ? 'config' : python ? 'plugin-venv' : 'none',
    venvBase: python ? venvBase(python) : null,
    cudaLib: (() => { try { return resolveCudaLib(env, cfg); } catch { return null; } })(),
    ffmpeg: env.DSH_FFMPEG_PATH || env.SOUNDTRY_FFMPEG || cfg.ffmpeg || null,
    device: env.SOUNDTRY_DEVICE || cfg.device || 'cuda',
    compute: env.SOUNDTRY_COMPUTE || cfg.compute || 'float16',
    pluginRoot: PLUGIN_ROOT,
    error,
  };
}

/**
 * 跑一个子命令。
 * @returns {Promise<{report: string, json: any}>}
 */
export function runSoundtry(subcommand, opts = {}) {
  const {
    args = [], env = process.env, signal, timeoutMs = 30 * 60 * 1000,
  } = opts;
  const cfg = loadConfig(env);
  const python = resolvePython(env, cfg);
  const cudaLib = resolveCudaLib(env, cfg);

  const childEnv = { ...env, PYTHONIOENCODING: 'utf-8', KMP_DUPLICATE_LIB_OK: 'TRUE' };
  if (cudaLib) {
    childEnv.PATH = `${cudaLib};${env.PATH ?? ''}`;
    childEnv.CUDA_PATH = childEnv.CUDA_PATH || dirname(cudaLib);
  }
  for (const extra of cfg.extraPath ?? []) {
    if (extra) childEnv.PATH = `${extra};${childEnv.PATH}`;
  }
  if (cfg.ffmpeg) childEnv.DSH_FFMPEG_PATH = childEnv.DSH_FFMPEG_PATH || cfg.ffmpeg;
  if (cfg.device) childEnv.SOUNDTRY_DEVICE = childEnv.SOUNDTRY_DEVICE || cfg.device;
  if (cfg.compute) childEnv.SOUNDTRY_COMPUTE = childEnv.SOUNDTRY_COMPUTE || cfg.compute;
  if (cfg.prompt) childEnv.SOUNDTRY_PROMPT = childEnv.SOUNDTRY_PROMPT || cfg.prompt;

  return new Promise((resolvePromise, reject) => {
    let child;
    try {
      child = spawn(python, [SCRIPT, subcommand, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: childEnv,
      });
    } catch (error) {
      reject(error);
      return;
    }

    const out = [];
    const err = [];
    let settled = false;
    let timer = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(value);
    };

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(reject, new Error(`soundtry ${subcommand} 超过 ${Math.round(timeoutMs / 1000)}s 未完成`));
      }, timeoutMs);
      timer.unref?.();
    }
    if (signal) {
      const onAbort = () => { child.kill('SIGKILL'); finish(reject, new Error('aborted')); };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (b) => out.push(b));
    child.stderr.on('data', (b) => err.push(b));
    child.on('error', (e) => finish(reject, e));
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      const idx = stdout.lastIndexOf(JSON_MARK);
      const report = (idx >= 0 ? stdout.slice(0, idx) : stdout).trim();
      let json = null;
      if (idx >= 0) {
        try {
          json = JSON.parse(stdout.slice(idx + JSON_MARK.length).trim());
        } catch { /* 交给下面报错 */ }
      }
      if (code !== 0) {
        const tail = stderr.trim().split('\n').slice(-6).join('\n');
        finish(reject, new Error(
          `soundtry ${subcommand} 退出码 ${code}${json ? '' : ''}\n${report}\n${tail}`.trim(),
        ));
        return;
      }
      finish(resolvePromise, { report, json, stderr });
    });
  });
}
