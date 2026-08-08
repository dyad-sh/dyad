import { useMemo, useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Cpu } from "lucide-react";

function getDayName(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, { weekday: "long" });
}

function getTimeGreetingKey(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*";

function useDecodeText(target: string, delay = 0, speed = 20) {
  const [display, setDisplay] = useState("");
  const [done, setDone] = useState(false);
  const frameRef = useRef(0);

  useEffect(() => {
    let iter = 0;
    const maxIter = target.length * 3 + 8;
    let startTime: number | null = null;

    const tick = (ts: number) => {
      if (startTime === null) startTime = ts;
      if (ts - startTime < delay) {
        frameRef.current = requestAnimationFrame(tick);
        return;
      }

      iter++;
      const revealCount = Math.floor((iter / maxIter) * target.length);
      let out = "";
      for (let i = 0; i < target.length; i++) {
        if (i < revealCount) {
          out += target[i];
        } else if (target[i] === " ") {
          out += " ";
        } else {
          out += CHARS[Math.floor(Math.random() * CHARS.length)];
        }
      }
      setDisplay(out);

      if (iter >= maxIter) {
        setDisplay(target);
        setDone(true);
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, delay, speed]);

  return { display, done };
}

export function HomeGreeting() {
  const { t, i18n } = useTranslation("home");

  const greeting = useMemo(() => {
    const now = new Date();
    const day = getDayName(now, i18n.language);
    const timeKey = getTimeGreetingKey(now.getHours());
    return {
      line: t(`homeChat.greeting.${timeKey}`),
      day: t("homeChat.greeting.happyDay", { day }),
    };
  }, [t, i18n.language]);

  const { display: dayDisplay, done: dayDone } = useDecodeText(
    greeting.day,
    200,
  );
  const { display: lineDisplay } = useDecodeText(greeting.line, 600);

  return (
    <div className="flex w-full max-w-full shrink-0 flex-col items-center gap-3 px-2 text-center">
      {/* Decorative top line */}
      <div className="jarvis-greeting-line mb-1" />

      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <div className="relative">
          <Cpu
            className="size-8 shrink-0 text-cyan-400 drop-shadow-[0_0_12px_rgba(0,229,255,0.6)]"
            aria-hidden
            strokeWidth={1.5}
          />
          <span className="jarvis-core-ping absolute inset-0 rounded-full" />
        </div>
        <h1
          data-testid="home-greeting"
          className="font-jarvis-display jarvis-glow-text text-balance text-2xl font-semibold sm:text-3xl md:text-4xl"
        >
          {dayDisplay}
          {!dayDone && (
            <span className="inline-block w-0.5 animate-pulse bg-cyan-400 align-middle ml-1 h-[0.8em]" />
          )}
        </h1>
      </div>

      <p className="jarvis-subtitle text-balance min-h-[1.2em]">
        {lineDisplay}
      </p>

      {/* Decorative bottom ornament */}
      <div className="jarvis-greeting-ornament mt-1" />
    </div>
  );
}
