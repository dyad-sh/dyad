import { useState, useRef, useEffect } from "react";

export const useTextToSpeech = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] =
    useState<SpeechSynthesisVoice | null>(null);

  // Load available voices
  useEffect(() => {
    const loadVoices = () => {
      const availableVoices =
        typeof window !== "undefined" && "speechSynthesis" in window
          ? window.speechSynthesis.getVoices()
          : [];
      setVoices(availableVoices);

      // Set default voice (prefer English voices)
      if (availableVoices.length > 0 && !selectedVoice) {
        const englishVoice =
          availableVoices.find(
            (voice) => voice.lang.startsWith("en-") && voice.default,
          ) ||
          availableVoices.find((voice) => voice.lang.startsWith("en-")) ||
          availableVoices[0];

        setSelectedVoice(englishVoice);
      }
    };

    loadVoices();
    speechSynthesis.addEventListener("voiceschanged", loadVoices);

    return () => {
      speechSynthesis.removeEventListener("voiceschanged", loadVoices);
    };
  }, [selectedVoice]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (utteranceRef.current) {
        speechSynthesis.cancel();
      }
    };
  }, []);

  // Convert message content to clean text for TTS
  const cleanTextForSpeech = (content: string): string => {
    if (!content) return "";

    let cleanText = content;

    // Remove Dyad tags and replace with descriptive text
    cleanText = cleanText.replace(
      /<dyad-write[^>]*path="([^"]*)"[^>]*>([\s\S]*?)<\/dyad-write>/g,
      (match, path, code) => `Writing file ${path}. ${code}`,
    );

    cleanText = cleanText.replace(
      /<dyad-edit[^>]*path="([^"]*)"[^>]*>([\s\S]*?)<\/dyad-edit>/g,
      (match, path, code) => `Editing file ${path}. ${code}`,
    );

    cleanText = cleanText.replace(
      /<dyad-execute-sql[^>]*>([\s\S]*?)<\/dyad-execute-sql>/g,
      (match, sql) => `Executing SQL query. ${sql}`,
    );

    cleanText = cleanText.replace(
      /<dyad-delete[^>]*path="([^"]*)"[^>]*>/g,
      "Deleting file $1",
    );

    cleanText = cleanText.replace(
      /<dyad-rename[^>]*from="([^"]*)"[^>]*to="([^"]*)"[^>]*>/g,
      "Renaming $1 to $2",
    );

    cleanText = cleanText.replace(
      /<dyad-add-dependency[^>]*packages="([^"]*)"[^>]*>/g,
      "Adding dependencies $1",
    );

    cleanText = cleanText.replace(
      /<think>([\s\S]*?)<\/think>/g,
      (match, thought) => `Thinking: ${thought}`,
    );

    // Remove any remaining HTML tags
    cleanText = cleanText.replace(/<[^>]*>/g, "");

    // Clean up markdown formatting
    cleanText = cleanText.replace(/```[\s\S]*?```/g, ""); // Remove code blocks
    cleanText = cleanText.replace(/`([^`]+)`/g, "$1"); // Remove inline code formatting
    cleanText = cleanText.replace(/\*\*([^*]+)\*\*/g, "$1"); // Remove bold
    cleanText = cleanText.replace(/\*([^*]+)\*/g, "$1"); // Remove italic
    cleanText = cleanText.replace(/#{1,6}\s/g, ""); // Remove markdown headers
    cleanText = cleanText.replace(/^\s*[-*+]\s/gm, ""); // Remove list markers
    cleanText = cleanText.replace(/^\s*\d+\.\s/gm, ""); // Remove numbered list markers

    // Clean up whitespace and decode entities
    cleanText = cleanText
      .replace(/\n{2,}/g, ". ") // Replace multiple newlines with period
      .replace(/\n/g, " ") // Replace single newlines with space
      .replace(/\s{2,}/g, " ") // Replace multiple spaces with single space
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .trim();

    return cleanText;
  };

  const speak = (
    text: string,
    options?: { rate?: number; pitch?: number; volume?: number },
  ) => {
    if (!text.trim()) return;

    // Stop any current speech
    speechSynthesis.cancel();

    const cleanText = cleanTextForSpeech(text);
    if (!cleanText.trim()) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utteranceRef.current = utterance;

    // Set voice and options
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    utterance.rate = options?.rate || 1;
    utterance.pitch = options?.pitch || 1;
    utterance.volume = options?.volume ?? 1;

    // Event handlers

    setIsPlaying(true);
    setIsPaused(false);

    utterance.onend = () => {
      setIsPlaying(false);
      setIsPaused(false);
      utteranceRef.current = null;
    };

    utterance.onerror = () => {
      setIsPlaying(false);
      setIsPaused(false);
      utteranceRef.current = null;
    };

    speechSynthesis.speak(utterance);
  };

  const pause = () => {
    if (speechSynthesis.speaking && !speechSynthesis.paused) {
      speechSynthesis.pause();
      setIsPaused(true);
    }
  };

  const resume = () => {
    if (speechSynthesis.paused) {
      speechSynthesis.resume();
      setIsPaused(false);
    }
  };

  const stop = () => {
    speechSynthesis.cancel();
    setIsPlaying(false);
    setIsPaused(false);
    utteranceRef.current = null;
  };

  const toggle = (
    text?: string,
    options?: { rate?: number; pitch?: number; volume?: number },
  ) => {
    if (isPlaying) {
      if (isPaused) {
        resume();
      } else {
        pause();
      }
    } else {
      if (text) {
        speak(text, options);
      }
    }
  };

  // Check if TTS is supported
  const isSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;
  return {
    speak,
    pause,
    resume,
    stop,
    toggle,
    isPlaying,
    isPaused,
    isSupported,
    voices,
    selectedVoice,
    setSelectedVoice,
  };
};
