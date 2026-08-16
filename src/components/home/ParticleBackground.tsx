import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

const BG_COLOR = "#0a0a0f";
const PARTICLE_COUNT = 88;
const GRID_SIZE = 52;
const CONNECT_DISTANCE = 128;
const MOUSE_RADIUS = 150;
const MOUSE_FORCE = 0.12;

export function particleCanvasHeight({
  visibleHeight,
  scrollHeight,
  clientHeight,
}: {
  visibleHeight: number;
  scrollHeight?: number;
  clientHeight?: number;
}) {
  return Math.max(scrollHeight ?? 0, clientHeight ?? 0, visibleHeight);
}

export function ParticleBackground({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const pulseRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const scrollOwner = container.parentElement;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;

    const initParticles = () => {
      particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        size: Math.random() * 1.8 + 0.8,
      }));
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const previousWidth = width;
      const previousHeight = height;
      const contentHeight = scrollOwner
        ? Array.from(scrollOwner.children).reduce((largest, child) => {
            if (child === container || !(child instanceof HTMLElement)) {
              return largest;
            }
            return Math.max(
              largest,
              child.offsetTop +
                Math.max(child.scrollHeight, child.offsetHeight),
            );
          }, 0)
        : 0;
      width = rect.width;
      // Most pages scroll inside their route root. An absolutely positioned
      // child otherwise measures only the visible client box and leaves a hard
      // edge once content extends below it (the missing background in Settings).
      height = particleCanvasHeight({
        visibleHeight: rect.height,
        // Measure real content instead of the owner's scrollHeight: the
        // absolute canvas itself participates in scroll overflow and would
        // otherwise prevent the background from shrinking after navigation.
        scrollHeight: contentHeight,
        clientHeight: scrollOwner?.clientHeight,
      });
      container.style.height = `${height}px`;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (
        particlesRef.current.length === 0 ||
        Math.abs(width - previousWidth) > 80 ||
        Math.abs(height - previousHeight) > 160
      ) {
        initParticles();
      }
    };

    const drawGrid = (pulse: number) => {
      const alpha = 0.035 + pulse * 0.025;
      ctx.strokeStyle = `rgba(0, 229, 255, ${alpha})`;
      ctx.lineWidth = 1;
      for (let x = 0; x <= width; x += GRID_SIZE) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
        ctx.stroke();
      }
      for (let y = 0; y <= height; y += GRID_SIZE) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
        ctx.stroke();
      }
    };

    const drawVignette = (pulse: number) => {
      const gradient = ctx.createRadialGradient(
        width / 2,
        height / 2,
        0,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.72,
      );
      gradient.addColorStop(0, `rgba(8, 24, 48, ${0.15 + pulse * 0.08})`);
      gradient.addColorStop(0.45, "rgba(4, 12, 28, 0.55)");
      gradient.addColorStop(1, "rgba(2, 4, 12, 0.92)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    };

    const animate = () => {
      pulseRef.current += 0.018;
      const pulse = (Math.sin(pulseRef.current) + 1) / 2;
      const particles = particlesRef.current;
      const mouse = mouseRef.current;

      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(0, 0, width, height);
      drawGrid(pulse);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x <= 0 || p.x >= width) p.vx *= -1;
        if (p.y <= 0 || p.y >= height) p.vy *= -1;
        p.x = Math.max(0, Math.min(width, p.x));
        p.y = Math.max(0, Math.min(height, p.y));

        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < MOUSE_RADIUS && dist > 1) {
          const force = ((MOUSE_RADIUS - dist) / MOUSE_RADIUS) * MOUSE_FORCE;
          p.vx -= (dx / dist) * force;
          p.vy -= (dy / dist) * force;
        }

        p.vx *= 0.992;
        p.vy *= 0.992;
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < CONNECT_DISTANCE) {
            const alpha =
              (1 - dist / CONNECT_DISTANCE) * 0.22 * (0.65 + pulse * 0.35);
            ctx.strokeStyle = `rgba(0, 229, 255, ${alpha})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      for (const p of particles) {
        const glow = 0.55 + pulse * 0.45;
        ctx.shadowBlur = 14 * glow;
        ctx.shadowColor = `rgba(0, 229, 255, ${0.75 * glow})`;
        ctx.fillStyle = `rgba(34, 211, 238, ${0.45 + pulse * 0.35})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      drawVignette(pulse);
      rafRef.current = requestAnimationFrame(animate);
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!inside) {
        mouseRef.current = { x: -9999, y: -9999 };
        return;
      }
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    resize();
    rafRef.current = requestAnimationFrame(animate);

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    if (scrollOwner) {
      ro.observe(scrollOwner);
      for (const child of scrollOwner.children) {
        if (child !== container) ro.observe(child);
      }
    }
    const mutationObserver = new MutationObserver(resize);
    if (scrollOwner) {
      mutationObserver.observe(scrollOwner, {
        childList: true,
        subtree: true,
      });
    }
    window.addEventListener("mousemove", onMouseMove);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "particle-background pointer-events-none absolute left-0 top-0 min-h-full w-full overflow-hidden",
        className,
      )}
      aria-hidden
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      <div className="jarvis-pulse-overlay absolute inset-0" />
    </div>
  );
}
