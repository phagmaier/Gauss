// Wording shared by the thread's progress and assessment summaries.

const WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];
export const word = (n: number) => WORDS[n] ?? String(n);
export const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
