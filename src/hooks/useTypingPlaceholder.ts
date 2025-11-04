import { useEffect, useState } from "react";

export function useTypingPlaceholder(
  phrases: string[],
  typingSpeed = 100,
  deletingSpeed = 50,
  pauseTime = 1500,
) {
  const [text, setText] = useState("");
  const [index, setIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [charIndex, setCharIndex] = useState(0);

  useEffect(() => {
    const current = phrases[index];
    const speed = deleting ? deletingSpeed : typingSpeed;
    const timer = setTimeout(() => {
      if (!deleting && charIndex < current.length) {
        setText((prev) => prev + current.charAt(charIndex));
        setCharIndex((prev) => prev + 1);
      } else if (deleting && charIndex > 0) {
        setText((prev) => prev.slice(0, -1));
        setCharIndex((prev) => prev - 1);
      } else if (!deleting && charIndex === current.length) {
        setTimeout(() => setDeleting(true), pauseTime);
      } else if (deleting && charIndex === 0) {
        setDeleting(false);
        setIndex((prev) => (prev + 1) % phrases.length);
      }
    }, speed);

    return () => clearTimeout(timer);
  }, [
    phrases,
    index,
    deleting,
    charIndex,
    typingSpeed,
    deletingSpeed,
    pauseTime,
  ]);

  return text;
}
