export function readingTime(content: string, wordsPerMinute = 200): number {
  if (!Number.isFinite(wordsPerMinute) || wordsPerMinute <= 0)
    throw new RangeError("Reading speed must be positive");
  const trimmed = content.trim();
  return trimmed ? Math.ceil(trimmed.split(/\s+/).length / wordsPerMinute) : 0;
}
export function formatReadingTime(minutes: number): string {
  return minutes < 1
    ? "Less than 1 min read"
    : minutes === 1
      ? "1 min read"
      : minutes + " min read";
}
export default readingTime;
