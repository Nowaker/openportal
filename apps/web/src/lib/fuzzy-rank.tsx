import type { ReactNode } from "react";

// Score one query word against a target string. Returns the score and
// the matched character ranges (for downstream highlighting), or score
// = -1 when the word does not match. Higher score = better match.
//
// Tiers:
//   1000 - whole-word query is a prefix of the target
//    800 - whole-word query appears at a word boundary mid-target
//    500 - whole-word query appears anywhere as a substring
//    var - fuzzy: query chars appear in order with gaps; scored by
//          contiguous-run length + word-boundary bonuses
//
// The scorer is intentionally word-aware: "session work" should rank a
// session titled "session work plan" far above one titled "assess
// network" (where the chars exist in order but don't form a real word).
function scoreWord(
  target: string,
  word: string,
): { score: number; ranges: Array<[number, number]> } {
  if (!word) return { score: 0, ranges: [] };

  const idx = target.indexOf(word);
  if (idx === 0) {
    return { score: 1000, ranges: [[0, word.length]] };
  }
  if (idx > 0) {
    const prevCharNonWord = !/\w/.test(target[idx - 1] ?? "");
    return {
      score: prevCharNonWord ? 800 : 500,
      ranges: [[idx, idx + word.length]],
    };
  }

  const ranges: Array<[number, number]> = [];
  let textPos = 0;
  let queryPos = 0;
  let score = 0;
  while (queryPos < word.length && textPos < target.length) {
    if (target[textPos] === word[queryPos]) {
      const runStart = textPos;
      while (
        queryPos < word.length &&
        textPos < target.length &&
        target[textPos] === word[queryPos]
      ) {
        textPos++;
        queryPos++;
      }
      const runLen = textPos - runStart;
      score += runLen * 10;
      const boundary = runStart === 0 || !/\w/.test(target[runStart - 1] ?? "");
      if (boundary) score += 30;
      ranges.push([runStart, textPos]);
    } else {
      textPos++;
    }
  }
  if (queryPos < word.length) return { score: -1, ranges: [] };
  return { score, ranges };
}

export interface MatchResult {
  score: number;
  titleRanges: Array<[number, number]>;
  projectRanges: Array<[number, number]>;
}

// Returns null if any query word fails to match in either field.
// Whitespace-separated words may match in any field, in any order;
// each word picks the field with the higher per-word score. Title
// matches weigh 2x project matches so a hit in the title outranks an
// equivalent hit in the project label.
export function scoreItem(
  title: string,
  project: string,
  rawQuery: string,
): MatchResult | null {
  const q = rawQuery.toLowerCase().trim();
  if (!q) {
    return { score: 0, titleRanges: [], projectRanges: [] };
  }

  const t = title.toLowerCase();
  const p = project.toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);

  let total = 0;
  const titleRanges: Array<[number, number]> = [];
  const projectRanges: Array<[number, number]> = [];

  for (const word of words) {
    const titleScore = scoreWord(t, word);
    const projectScore = scoreWord(p, word);

    if (titleScore.score < 0 && projectScore.score < 0) {
      return null;
    }
    if (
      titleScore.score >= 0 &&
      titleScore.score * 2 >= projectScore.score
    ) {
      total += titleScore.score * 2;
      titleRanges.push(...titleScore.ranges);
    } else {
      total += projectScore.score;
      projectRanges.push(...projectScore.ranges);
    }
  }

  return { score: total, titleRanges, projectRanges };
}

function mergeRanges(
  ranges: Array<[number, number]>,
): Array<[number, number]> {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1];
    const cur = sorted[i];
    if (cur[0] <= prev[1]) {
      prev[1] = Math.max(prev[1], cur[1]);
    } else {
      out.push(cur);
    }
  }
  return out;
}

interface HighlightedTextProps {
  text: string;
  ranges: Array<[number, number]>;
  className?: string;
  matchClassName?: string;
}

// Render text with character ranges wrapped in <mark>. Ranges are
// merged + sorted so overlapping/adjacent fuzzy hits render as a
// single contiguous highlight.
export function HighlightedText({
  text,
  ranges,
  className,
  matchClassName,
}: HighlightedTextProps): ReactNode {
  if (ranges.length === 0) {
    return className ? <span className={className}>{text}</span> : <>{text}</>;
  }
  const merged = mergeRanges(ranges);
  const out: ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < merged.length; i++) {
    const [s, e] = merged[i];
    if (s > cursor) out.push(<span key={`p${i}`}>{text.slice(cursor, s)}</span>);
    out.push(
      <mark
        key={`m${i}`}
        className={
          matchClassName ??
          "bg-amber-200/80 text-fg dark:bg-amber-400/30 dark:text-fg rounded-sm"
        }
      >
        {text.slice(s, e)}
      </mark>,
    );
    cursor = e;
  }
  if (cursor < text.length) out.push(<span key="tail">{text.slice(cursor)}</span>);
  return className ? <span className={className}>{out}</span> : <>{out}</>;
}
