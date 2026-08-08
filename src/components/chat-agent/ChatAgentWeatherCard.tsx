import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  Moon,
  Sun,
  Wind,
} from "lucide-react";
import type { ChatAgentToolPresentation } from "@/ipc/types/chat_agent";

type WeatherPresentation = Extract<
  ChatAgentToolPresentation,
  { kind: "weather-forecast" }
>;

function weatherCondition(code: number) {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code >= 95) return "Thunderstorm";
  return "Mixed conditions";
}

function WeatherIcon({
  code,
  isDay = true,
  className,
}: {
  code: number;
  isDay?: boolean;
  className?: string;
}) {
  if (code === 0) {
    const Icon = isDay ? Sun : Moon;
    return <Icon className={className} />;
  }
  if (code <= 2) return <CloudSun className={className} />;
  if (code === 3) return <Cloud className={className} />;
  if (code === 45 || code === 48) return <CloudFog className={className} />;
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) {
    return <CloudSnow className={className} />;
  }
  if (code >= 95) return <CloudLightning className={className} />;
  return <CloudRain className={className} />;
}

function dayLabel(value: string, index: number) {
  if (index === 0) return "Today";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
}

export function ChatAgentWeatherCard({
  presentation,
}: {
  presentation: WeatherPresentation;
}) {
  const location = [
    presentation.location.name,
    presentation.location.admin1,
    presentation.location.country,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <section className="chat-card-fly-in mt-3 overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#061225]/95 shadow-[0_0_28px_rgba(0,229,255,0.07)]">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-400/12 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-cyan-400/10 text-cyan-300">
            <WeatherIcon
              code={presentation.current.weatherCode}
              isDay={presentation.current.isDay}
              className="size-5"
            />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-cyan-50">
              {location}
            </div>
            <div className="text-xs text-cyan-100/45">
              Live weather · {presentation.timezone ?? "local time"}
            </div>
          </div>
        </div>
        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/8 px-2.5 py-1 text-[0.65rem] font-medium text-emerald-300">
          LIVE
        </span>
      </header>

      <div className="grid gap-5 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="flex items-center gap-4">
          <WeatherIcon
            code={presentation.current.weatherCode}
            isDay={presentation.current.isDay}
            className="size-14 shrink-0 text-cyan-300"
          />
          <div>
            <div className="text-4xl font-semibold tracking-tight text-cyan-50">
              {Math.round(presentation.current.temperature)}
              <span className="ml-0.5 text-xl text-cyan-100/55">
                {presentation.units.temperature}
              </span>
            </div>
            <div className="mt-1 text-sm text-cyan-100/60">
              {weatherCondition(presentation.current.weatherCode)}
              {presentation.current.apparentTemperature != null
                ? ` · Feels like ${Math.round(presentation.current.apparentTemperature)}${presentation.units.temperature}`
                : ""}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-xs text-cyan-100/55">
          <span className="inline-flex items-center gap-1.5">
            <Droplets className="size-3.5 text-cyan-300" />
            {presentation.current.humidity ?? "—"}% humidity
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Wind className="size-3.5 text-cyan-300" />
            {presentation.current.windSpeed ?? "—"}{" "}
            {presentation.units.windSpeed}
          </span>
          <span>
            Rain {presentation.current.precipitation ?? 0}{" "}
            {presentation.units.precipitation}
          </span>
          <span>
            Gusts {presentation.current.windGusts ?? "—"}{" "}
            {presentation.units.windSpeed}
          </span>
        </div>
      </div>

      <div className="scrollbar-on-hover flex gap-2 overflow-x-auto border-t border-cyan-400/10 p-3">
        {presentation.daily.map((day, index) => (
          <div
            key={day.date}
            className="min-w-24 flex-1 rounded-xl border border-cyan-400/10 bg-cyan-400/4 px-3 py-3 text-center"
          >
            <div className="text-xs font-medium text-cyan-100/70">
              {dayLabel(day.date, index)}
            </div>
            <WeatherIcon
              code={day.weatherCode}
              className="mx-auto my-2 size-5 text-cyan-300"
            />
            <div className="text-sm font-semibold text-cyan-50">
              {Math.round(day.temperatureMax)}°
              <span className="ml-1 font-normal text-cyan-100/40">
                {Math.round(day.temperatureMin)}°
              </span>
            </div>
            <div className="mt-1 text-[0.65rem] text-cyan-100/40">
              {day.precipitationProbability ?? 0}% rain
            </div>
          </div>
        ))}
      </div>

      <footer className="border-t border-cyan-400/10 px-4 py-2 text-[10px] text-cyan-100/35">
        Forecast data from Open-Meteo · conditions can change
      </footer>
    </section>
  );
}
