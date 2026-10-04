const weekdays = ["日", "月", "火", "水", "木", "金", "土"];

export function formatBoardDate(date: Date): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}(${weekdays[date.getDay()]}) ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(Math.floor(date.getMilliseconds() / 10))}`;
}

export function createSequentialBoardDates(count: number, base = new Date()): string[] {
  return Array.from({ length: count }, (_, index) =>
    formatBoardDate(new Date(base.getTime() + index * 1000))
  );
}

export function formatLocalDateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
