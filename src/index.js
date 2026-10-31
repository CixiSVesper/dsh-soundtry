/**
 * index.js — DSH-SoundTry 插件入口。
 *
 * 把"听"这件事变成四个本地工具：所有重活都在 python/soundtry.py 里跑，
 * Python 与 CUDA 从 ComfyUI 借（见 docs/ENVIRONMENT.md），不重复安装。
 */
import { readSpec, transcribeSpec, rhythmSpec, melodySpec, chordsSpec, structureSpec } from './tools.js';
import { environmentReport } from './runner.js';

export const name = 'dsh-soundtry';
export const inject = ['tools'];

function fail(error) {
  const message = String(error?.message ?? error);
  return { text: `sound error: ${message}` };
}

export async function apply(ctx) {
  // 一次环境体检：缺 Python / 缺 CUDA 运行库都在这里说清楚，而不是等第一次调用失败。
  const env = environmentReport();
  if (!env.python) {
    console.error(`[soundtry] ${env.error}`);
  } else if (process.env.DSH_SOUNDTRY_DEBUG) {
    console.error(`[soundtry] ${JSON.stringify(env)}`);
  }

  const disposers = [];
  const register = (spec) => {
    try {
      disposers.push(ctx.tools.register(spec));
    } catch (error) {
      console.error(`[soundtry] failed to register ${spec.name}: ${error?.message ?? error}`);
    }
  };

  const wrap = (spec) => {
    const inner = spec.execute;
    spec.execute = async (args, exec) => {
      try {
        return await inner(args, exec);
      } catch (error) {
        return fail(error);
      }
    };
    return spec;
  };

  register(wrap(readSpec()));
  register(wrap(transcribeSpec()));
  register(wrap(rhythmSpec()));
  register(wrap(melodySpec()));
  register(wrap(chordsSpec()));
  register(wrap(structureSpec()));

  return () => {
    for (const dispose of disposers.reverse()) {
      try { dispose?.(); } catch { /* ignore */ }
    }
  };
}
