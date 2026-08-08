import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Device picker with a live input meter.
 *
 * Chromium chooses its own default capture device, which is not always the one
 * macOS reports as default — and a device can be permitted yet deliver pure
 * silence. Showing the real signal per device is the only reliable way to tell
 * which one actually works.
 */
export function MicrophoneTester({
  deviceId,
  onDeviceChange,
}: {
  deviceId?: string;
  onDeviceChange: (deviceId: string | undefined) => void;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [isTesting, setIsTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);

  const loadDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((device) => device.kind === "audioinput"));
    } catch {
      setError("Could not list audio devices.");
    }
  }, []);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  const stopTest = useCallback(() => {
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close().catch(() => {});
    contextRef.current = null;
    setIsTesting(false);
    setLevel(0);
  }, []);

  useEffect(() => stopTest, [stopTest]);

  const startTest = useCallback(async () => {
    setError(null);
    setPeak(0);
    try {
      // Match the live session: no processing, so the meter shows what JARVIS
      // would actually receive.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
      });
      streamRef.current = stream;
      // Labels only populate once permission has been granted.
      void loadDevices();

      const context = new AudioContext();
      contextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(new ArrayBuffer(analyser.fftSize));

      setIsTesting(true);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let highest = 0;
        for (const sample of data) {
          highest = Math.max(highest, Math.abs(sample - 128) / 128);
        }
        setLevel(highest);
        setPeak((previous) => Math.max(previous, highest));
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
    } catch (caught) {
      setError(
        caught instanceof DOMException && caught.name === "NotAllowedError"
          ? "Microphone access was denied for this app."
          : "Could not open that microphone.",
      );
      stopTest();
    }
  }, [deviceId, loadDevices, stopTest]);

  return (
    <div className="rounded-xl border border-cyan-400/15 bg-slate-950/35 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <label
            htmlFor="jarvis-input-device"
            className="text-sm font-medium text-cyan-50"
          >
            Input device
          </label>
          <p className="mt-1 text-xs leading-5 text-cyan-100/45">
            Test a device before starting a session. A working microphone moves
            the meter when you speak; a dead one stays flat.
          </p>
        </div>
        <select
          id="jarvis-input-device"
          value={deviceId ?? ""}
          onChange={(event) => onDeviceChange(event.target.value || undefined)}
          className="w-64 shrink-0 rounded-lg border border-cyan-400/20 bg-slate-950/60 px-3 py-2 text-sm text-cyan-50"
        >
          <option value="">System default</option>
          {devices.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Microphone ${index + 1}`}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => (isTesting ? stopTest() : void startTest())}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-400/25 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-400/10"
          data-testid="jarvis-test-microphone"
        >
          {isTesting ? (
            <Square className="size-3.5" />
          ) : (
            <Mic className="size-3.5" />
          )}
          {isTesting ? "Stop test" : "Test microphone"}
        </button>

        <div
          className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-950/60"
          role="meter"
          aria-label="Microphone input level"
          aria-valuenow={Math.round(level * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-75",
              level > 0.02 ? "bg-emerald-400" : "bg-cyan-400/30",
            )}
            style={{ width: `${Math.min(100, level * 140)}%` }}
          />
        </div>

        <span className="w-24 shrink-0 text-right font-mono text-[11px] text-cyan-100/50">
          peak {peak.toFixed(3)}
        </span>
      </div>

      {isTesting && peak < 0.01 && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-200/80">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          No signal from this device yet. Speak, or try another input.
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-rose-300/80" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
