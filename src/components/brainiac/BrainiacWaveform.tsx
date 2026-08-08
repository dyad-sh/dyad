import type { BrainiacVoiceState } from "./brainiac-voice-state";

const WAVEFORM_MARKS = Array.from({ length: 24 }, (_, i) => i);

export function BrainiacWaveform({
  active,
  voiceState,
}: {
  active: boolean;
  voiceState: BrainiacVoiceState;
}) {
  return (
    <div
      className={
        active
          ? "brainiac-waveform brainiac-waveform--active"
          : "brainiac-waveform"
      }
      data-testid="brainiac-waveform"
      data-voice-state={voiceState}
      aria-hidden
    >
      <svg
        viewBox="0 0 800 48"
        preserveAspectRatio="none"
        className="brainiac-waveform-svg"
      >
        <path
          className="brainiac-waveform-path"
          d="M0,24 L20,24 L25,8 L30,40 L35,16 L40,32 L45,24 L800,24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          className="brainiac-waveform-path brainiac-waveform-path--echo"
          d="M0,24 L20,24 L25,12 L30,36 L35,20 L40,28 L45,24 L800,24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.4"
        />
      </svg>
      <div className="brainiac-waveform-marks" aria-hidden>
        {WAVEFORM_MARKS.map((mark) => (
          <span key={mark} />
        ))}
      </div>
    </div>
  );
}
