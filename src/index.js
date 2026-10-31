/**
 * index.js — DSH-SoundTry 插件入口。
 *
 * 1.0：六个工具，依赖声明在 deps.manifest.json。首次调用自动装依赖 + 下模型；
 * 装了 ComfyUI 的话优先借它的 torch / CUDA（省 7 GB），否则整套装进插件 venv。
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
  // 只报状态，不在这里装东西（安装放到第一次真实调用，避免启动时卡住）
  const env = environmentReport();
  if (!env.ready) {
    console.error(`[soundtry] ${env.hint}`);
    console.error(`[soundtry] 依赖源: ${env.base ?? "未找到"}${env.baseWhy ? ` (${env.baseWhy})` : ""}`);
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
