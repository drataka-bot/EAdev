interface Props {
  current: number;
  total: number;
  speed: number; // 件/分
  active: boolean;
}

export function ProgressBar({ current, total, speed, active }: Props) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  return (
    <div className="bg-base-700/60 border border-base-500 rounded-lg p-4">
      <div className="flex items-center justify-between text-sm mb-2">
        <span className="text-gray-300">
          {active ? "リサーチ中..." : "待機中"}
          <span className="ml-3 text-accent font-bold">
            {current} / {total}
          </span>
        </span>
        <span className="text-gray-400">
          処理速度: <span className="text-accent">{speed.toFixed(1)}</span> 件/分
        </span>
      </div>
      <div className="h-2 bg-base-900 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-accent to-cyan-300 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
