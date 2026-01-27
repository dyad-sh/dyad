/**
 * Voice Input Button Component
 * Push-to-talk / continuous listening button for chat input
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Mic,
  MicOff,
  Settings,
  Loader2,
  Volume2,
  VolumeX,
  AudioWaveform,
  Download,
  Check,
  AlertCircle,
} from "lucide-react";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import type { TranscriptionResult, VoiceCommand } from "@/ipc/voice_assistant_client";

// =============================================================================
// TYPES
// =============================================================================

export interface VoiceInputButtonProps {
  onTranscription?: (text: string) => void;
  onCommand?: (command: VoiceCommand) => void;
  className?: string;
  size?: "sm" | "default" | "lg";
  showSettings?: boolean;
  disabled?: boolean;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function VoiceInputButton({
  onTranscription,
  onCommand,
  className,
  size = "default",
  showSettings = true,
  disabled = false,
}: VoiceInputButtonProps) {
  const [showConfig, setShowConfig] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  
  const {
    state,
    isListening,
    isProcessing,
    isSpeaking,
    isReady,
    config,
    updateConfig,
    currentTranscription,
    startListening,
    stopListening,
    toggleListening,
    initialize,
    downloadModel,
    installedModels,
  } = useVoiceInput({
    autoInitialize: false,
    onTranscription: (result: TranscriptionResult) => {
      onTranscription?.(result.text);
    },
    onCommand: (command: VoiceCommand) => {
      onCommand?.(command);
    },
  });
  
  // ---------------------------------------------------------------------------
  // AUDIO VISUALIZATION
  // ---------------------------------------------------------------------------
  
  useEffect(() => {
    if (isListening) {
      startAudioVisualization();
    } else {
      stopAudioVisualization();
    }
    
    return () => stopAudioVisualization();
  }, [isListening]);
  
  const startAudioVisualization = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
      
      analyserRef.current.fftSize = 256;
      const bufferLength = analyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      const updateLevel = () => {
        if (!analyserRef.current) return;
        
        analyserRef.current.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / bufferLength;
        setAudioLevel(average / 255);
        
        animationRef.current = requestAnimationFrame(updateLevel);
      };
      
      updateLevel();
    } catch (error) {
      console.error("Failed to start audio visualization:", error);
    }
  };
  
  const stopAudioVisualization = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setAudioLevel(0);
  };
  
  // ---------------------------------------------------------------------------
  // HANDLERS
  // ---------------------------------------------------------------------------
  
  const handleClick = useCallback(async () => {
    if (!isReady) {
      await initialize();
    }
    await toggleListening();
  }, [isReady, initialize, toggleListening]);
  
  const handleMouseDown = useCallback(async () => {
    if (config?.mode === "push-to-talk") {
      if (!isReady) {
        await initialize();
      }
      await startListening();
    }
  }, [config?.mode, isReady, initialize, startListening]);
  
  const handleMouseUp = useCallback(async () => {
    if (config?.mode === "push-to-talk" && isListening) {
      await stopListening();
    }
  }, [config?.mode, isListening, stopListening]);
  
  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------
  
  const buttonSize = {
    sm: "h-8 w-8",
    default: "h-10 w-10",
    lg: "h-12 w-12",
  }[size];
  
  const iconSize = {
    sm: "h-4 w-4",
    default: "h-5 w-5",
    lg: "h-6 w-6",
  }[size];
  
  const getButtonContent = () => {
    if (isProcessing) {
      return <Loader2 className={cn(iconSize, "animate-spin")} />;
    }
    if (isSpeaking) {
      return <Volume2 className={cn(iconSize, "animate-pulse")} />;
    }
    if (isListening) {
      return <Mic className={cn(iconSize, "text-red-500")} />;
    }
    return <Mic className={iconSize} />;
  };
  
  const getButtonVariant = () => {
    if (isListening) return "destructive";
    if (isSpeaking) return "secondary";
    return "ghost";
  };
  
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={getButtonVariant()}
              size="icon"
              className={cn(
                buttonSize,
                "relative transition-all",
                isListening && "ring-2 ring-red-500 ring-opacity-50",
                disabled && "opacity-50 cursor-not-allowed"
              )}
              onClick={config?.mode !== "push-to-talk" ? handleClick : undefined}
              onMouseDown={config?.mode === "push-to-talk" ? handleMouseDown : undefined}
              onMouseUp={config?.mode === "push-to-talk" ? handleMouseUp : undefined}
              onMouseLeave={config?.mode === "push-to-talk" && isListening ? handleMouseUp : undefined}
              disabled={disabled}
            >
              {getButtonContent()}
              
              {/* Audio level indicator */}
              {isListening && (
                <span
                  className="absolute inset-0 rounded-md bg-red-500 opacity-20 transition-transform"
                  style={{
                    transform: `scale(${1 + audioLevel * 0.5})`,
                  }}
                />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {isListening ? (
              config?.mode === "push-to-talk" ? "Release to stop" : "Click to stop"
            ) : (
              config?.mode === "push-to-talk" ? "Hold to speak" : "Click to start"
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      {showSettings && (
        <Popover open={showConfig} onOpenChange={setShowConfig}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Settings className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
            <VoiceSettings
              config={config}
              onUpdate={updateConfig}
              onDownloadModel={downloadModel}
              installedModels={installedModels}
            />
          </PopoverContent>
        </Popover>
      )}
      
      {/* Transcription preview */}
      {isProcessing && currentTranscription && (
        <Badge variant="outline" className="animate-pulse">
          Processing...
        </Badge>
      )}
    </div>
  );
}

// =============================================================================
// VOICE SETTINGS PANEL
// =============================================================================

interface VoiceSettingsProps {
  config: ReturnType<typeof useVoiceInput>["config"];
  onUpdate: (updates: Partial<NonNullable<ReturnType<typeof useVoiceInput>["config"]>>) => Promise<void>;
  onDownloadModel: (model: "tiny" | "base" | "small" | "medium" | "large") => Promise<void>;
  installedModels: { whisper: string[]; tts: string[] } | null;
}

function VoiceSettings({ config, onUpdate, onDownloadModel, installedModels }: VoiceSettingsProps) {
  const [downloading, setDownloading] = useState<string | null>(null);
  
  const handleDownload = async (model: "tiny" | "base" | "small" | "medium" | "large") => {
    setDownloading(model);
    try {
      await onDownloadModel(model);
    } finally {
      setDownloading(null);
    }
  };
  
  if (!config) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  
  const whisperModels = [
    { id: "tiny", name: "Tiny", size: "39MB", speed: "Fast" },
    { id: "base", name: "Base", size: "74MB", speed: "Good" },
    { id: "small", name: "Small", size: "244MB", speed: "Better" },
    { id: "medium", name: "Medium", size: "769MB", speed: "Best" },
    { id: "large", name: "Large", size: "1.5GB", speed: "Premium" },
  ] as const;
  
  return (
    <div className="space-y-4">
      <div className="font-medium flex items-center gap-2">
        <Mic className="h-4 w-4" />
        Voice Settings
      </div>
      
      {/* Mode Selection */}
      <div className="space-y-2">
        <Label>Input Mode</Label>
        <Select
          value={config.mode}
          onValueChange={(value) => onUpdate({ mode: value as typeof config.mode })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="push-to-talk">Push to Talk</SelectItem>
            <SelectItem value="continuous">Continuous</SelectItem>
            <SelectItem value="wake-word">Wake Word</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      {/* Wake Word (if enabled) */}
      {config.mode === "wake-word" && (
        <div className="space-y-2">
          <Label>Wake Word</Label>
          <Select
            value={config.wakeWord}
            onValueChange={(value) => onUpdate({ wakeWord: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hey joy">Hey Joy</SelectItem>
              <SelectItem value="ok joy">OK Joy</SelectItem>
              <SelectItem value="joy">Joy</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      
      {/* Whisper Model */}
      <div className="space-y-2">
        <Label>Transcription Model</Label>
        <div className="grid grid-cols-1 gap-2">
          {whisperModels.map((model) => {
            const isInstalled = installedModels?.whisper.some(m => m.includes(model.id));
            const isSelected = config.whisperModel === model.id;
            const isDownloading = downloading === model.id;
            
            return (
              <div
                key={model.id}
                className={cn(
                  "flex items-center justify-between p-2 rounded-md border cursor-pointer transition-colors",
                  isSelected && "border-primary bg-primary/5",
                  !isSelected && "hover:bg-muted"
                )}
                onClick={() => isInstalled && onUpdate({ whisperModel: model.id })}
              >
                <div className="flex items-center gap-2">
                  <div className="font-medium">{model.name}</div>
                  <Badge variant="outline" className="text-xs">
                    {model.size}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {model.speed}
                  </Badge>
                </div>
                <div>
                  {isDownloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isInstalled ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownload(model.id);
                      }}
                    >
                      <Download className="h-4 w-4 mr-1" />
                      Download
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* TTS Model */}
      <div className="space-y-2">
        <Label>Voice Output</Label>
        <Select
          value={config.ttsModel}
          onValueChange={(value) => onUpdate({ ttsModel: value as typeof config.ttsModel })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="piper">Piper (Fast)</SelectItem>
            <SelectItem value="bark">Bark (Natural)</SelectItem>
            <SelectItem value="coqui">Coqui (Quality)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      {/* Language */}
      <div className="space-y-2">
        <Label>Language</Label>
        <Select
          value={config.language}
          onValueChange={(value) => onUpdate({ language: value })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="es">Spanish</SelectItem>
            <SelectItem value="fr">French</SelectItem>
            <SelectItem value="de">German</SelectItem>
            <SelectItem value="it">Italian</SelectItem>
            <SelectItem value="pt">Portuguese</SelectItem>
            <SelectItem value="zh">Chinese</SelectItem>
            <SelectItem value="ja">Japanese</SelectItem>
            <SelectItem value="ko">Korean</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      {/* Options */}
      <div className="space-y-3 pt-2 border-t">
        <div className="flex items-center justify-between">
          <Label htmlFor="auto-submit">Auto-submit after transcription</Label>
          <Switch
            id="auto-submit"
            checked={config.autoSubmit}
            onCheckedChange={(checked) => onUpdate({ autoSubmit: checked })}
          />
        </div>
        
        <div className="flex items-center justify-between">
          <Label htmlFor="sound-effects">Sound effects</Label>
          <Switch
            id="sound-effects"
            checked={config.soundEffects}
            onCheckedChange={(checked) => onUpdate({ soundEffects: checked })}
          />
        </div>
        
        <div className="flex items-center justify-between">
          <Label htmlFor="continuous-mode">Keep listening after response</Label>
          <Switch
            id="continuous-mode"
            checked={config.continuousMode}
            onCheckedChange={(checked) => onUpdate({ continuousMode: checked })}
          />
        </div>
      </div>
    </div>
  );
}

export default VoiceInputButton;
