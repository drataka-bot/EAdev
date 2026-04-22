import type { ScoreGrade } from "../types";

const STYLES: Record<string, string> = {
  S: "bg-gradient-to-r from-pink-500 to-red-500 text-white shadow-lg shadow-pink-500/20",
  A: "bg-gradient-to-r from-amber-400 to-orange-500 text-black",
  B: "bg-gradient-to-r from-accent to-cyan-400 text-black",
  C: "bg-base-500 text-gray-200",
  D: "bg-base-600 text-gray-400",
  "-": "bg-base-700 text-gray-500",
};

export function ScoreBadge({ grade }: { grade: ScoreGrade | string }) {
  const cls = STYLES[grade] ?? STYLES["-"];
  return (
    <span
      className={`inline-flex items-center justify-center w-8 h-8 rounded-md font-bold text-sm ${cls}`}
    >
      {grade}
    </span>
  );
}
