/**
 * Video Studio — AI video generation, editing, and management
 *
 * Features:
 * - Text-to-video generation (Sora, Runway, Kling, local)
 * - Image-to-video animation
 * - Video editing (trim, merge, transitions, captions)
 * - AI-powered video effects (style transfer, slow-mo, interpolation)
 * - Gallery with metadata and tags
 * - Export to multiple formats
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Video, Wand2, Play, Pause, Scissors, Download, Upload,
  Search, Film, Clapperboard, Timer, Zap, Image as ImageLucide,
  Type, Music, Sparkles, RotateCcw, Layers, Settings,
  FastForward, Rewind, Volume2, Grid3X3,
} from "lucide-react";

function VideoGenerateTab() {
  const [prompt, setPrompt] = useState("");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="space-y-4">
        <div>
          <Label className="text-xs">Prompt</Label>
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="A timelapse of a blooming flower in a sunlit meadow, cinematic 4K..." className="mt-1" rows={4} />
        </div>
        <div>
          <Label className="text-xs">Model</Label>
          <Select defaultValue="kling">
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sora">OpenAI Sora</SelectItem>
              <SelectItem value="runway">Runway Gen-3</SelectItem>
              <SelectItem value="kling">Kling AI</SelectItem>
              <SelectItem value="pika">Pika Labs</SelectItem>
              <SelectItem value="stable-video">Stable Video Diffusion</SelectItem>
              <SelectItem value="local">Local Model</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Duration</Label>
            <Select defaultValue="5">
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3 seconds</SelectItem>
                <SelectItem value="5">5 seconds</SelectItem>
                <SelectItem value="10">10 seconds</SelectItem>
                <SelectItem value="15">15 seconds</SelectItem>
                <SelectItem value="30">30 seconds</SelectItem>
                <SelectItem value="60">60 seconds</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Resolution</Label>
            <Select defaultValue="1080p">
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="480p">480p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
                <SelectItem value="1080p">1080p</SelectItem>
                <SelectItem value="4k">4K</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">FPS</Label>
            <Select defaultValue="24">
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 fps</SelectItem>
                <SelectItem value="24">24 fps</SelectItem>
                <SelectItem value="30">30 fps</SelectItem>
                <SelectItem value="60">60 fps</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Aspect Ratio</Label>
            <Select defaultValue="16:9">
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="16:9">16:9</SelectItem>
                <SelectItem value="9:16">9:16 (Vertical)</SelectItem>
                <SelectItem value="1:1">1:1 (Square)</SelectItem>
                <SelectItem value="4:3">4:3</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label className="text-xs">Motion Intensity: 50%</Label>
          <Slider defaultValue={[50]} min={0} max={100} step={1} className="mt-2" />
        </div>
        <div>
          <Label className="text-xs">Reference Image (optional)</Label>
          <div className="mt-1 border border-dashed border-border/50 rounded-lg p-4 text-center cursor-pointer hover:bg-muted/10">
            <Upload className="w-5 h-5 mx-auto mb-1 text-muted-foreground/30" />
            <p className="text-[10px] text-muted-foreground/40">Drop image for img2vid</p>
          </div>
        </div>
        <Button className="w-full" onClick={() => toast.info("Generating video...")}>
          <Wand2 className="w-4 h-4 mr-1.5" /> Generate Video
        </Button>
      </div>

      <div className="lg:col-span-2">
        <Card className="bg-muted/10 border-border/30 h-full min-h-[400px] flex items-center justify-center">
          <div className="text-center">
            <Video className="w-16 h-16 mx-auto mb-4 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/40">Generated videos will appear here</p>
            <p className="text-[10px] text-muted-foreground/30 mt-1">Enter a prompt and click Generate</p>
          </div>
        </Card>
      </div>
    </div>
  );
}

function VideoEditTab() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Trim & Cut", desc: "Cut video segments", icon: <Scissors className="w-5 h-5" /> },
          { label: "Merge", desc: "Combine multiple clips", icon: <Layers className="w-5 h-5" /> },
          { label: "Add Captions", desc: "AI-powered subtitles", icon: <Type className="w-5 h-5" /> },
          { label: "Add Music", desc: "Background audio", icon: <Music className="w-5 h-5" /> },
          { label: "Slow Motion", desc: "AI frame interpolation", icon: <Timer className="w-5 h-5" /> },
          { label: "Style Transfer", desc: "Apply visual styles", icon: <Sparkles className="w-5 h-5" /> },
          { label: "Stabilize", desc: "Reduce camera shake", icon: <RotateCcw className="w-5 h-5" /> },
          { label: "Img to Video", desc: "Animate still images", icon: <ImageLucide className="w-5 h-5" /> },
        ].map(tool => (
          <Button key={tool.label} variant="outline" className="h-auto py-4 flex-col gap-2" onClick={() => toast.info(`Opening ${tool.label}...`)}>
            {tool.icon}
            <span className="text-xs font-medium">{tool.label}</span>
            <span className="text-[9px] text-muted-foreground/50">{tool.desc}</span>
          </Button>
        ))}
      </div>

      {/* Timeline mockup */}
      <Card className="bg-muted/10 border-border/30">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Button variant="outline" size="sm" className="h-7 w-7 p-0"><Rewind className="w-3.5 h-3.5" /></Button>
            <Button size="sm" className="h-7 w-7 p-0"><Play className="w-3.5 h-3.5" /></Button>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0"><FastForward className="w-3.5 h-3.5" /></Button>
            <span className="text-[10px] text-muted-foreground/50 ml-2">00:00 / 00:00</span>
            <div className="flex-1" />
            <Button variant="outline" size="sm" className="h-7 w-7 p-0"><Volume2 className="w-3.5 h-3.5" /></Button>
          </div>
          {/* Timeline tracks */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-muted-foreground/40 w-12">Video</span>
              <div className="flex-1 h-8 bg-muted/20 rounded border border-border/30 flex items-center justify-center">
                <span className="text-[9px] text-muted-foreground/30">Drop video clips here</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-muted-foreground/40 w-12">Audio</span>
              <div className="flex-1 h-6 bg-muted/20 rounded border border-border/30 flex items-center justify-center">
                <span className="text-[9px] text-muted-foreground/30">Audio track</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-muted-foreground/40 w-12">Text</span>
              <div className="flex-1 h-6 bg-muted/20 rounded border border-border/30 flex items-center justify-center">
                <span className="text-[9px] text-muted-foreground/30">Captions / titles</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function VideoGalleryTab() {
  const mockVideos = Array.from({ length: 6 }, (_, i) => ({
    id: `vid-${i}`,
    prompt: `Generated video ${i + 1}`,
    model: ["Kling AI", "Runway Gen-3", "Sora"][i % 3],
    duration: `${3 + i * 2}s`,
    resolution: "1080p",
  }));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <Input placeholder="Search videos..." className="pl-10 h-8 text-xs" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {mockVideos.map(vid => (
          <Card key={vid.id} className="bg-muted/10 border-border/30 group cursor-pointer hover:border-primary/30">
            <div className="aspect-video bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-t-lg flex items-center justify-center relative">
              <Play className="w-10 h-10 text-white/40" />
              <Badge className="absolute bottom-2 right-2 bg-black/60 text-white text-[9px]">{vid.duration}</Badge>
            </div>
            <CardContent className="p-2">
              <p className="text-[10px] text-muted-foreground/60 truncate">{vid.prompt}</p>
              <div className="flex items-center justify-between mt-1">
                <Badge variant="outline" className="text-[8px]">{vid.model}</Badge>
                <span className="text-[9px] text-muted-foreground/40">{vid.resolution}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function VideoStudioPage() {
  const [activeTab, setActiveTab] = useState("generate");

  return (
    <div className="h-full flex flex-col">
      <div className="border-b p-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center">
            <Video className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Video Studio</h1>
            <p className="text-sm text-muted-foreground">AI video generation, editing, and management</p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="border-b px-4">
          <TabsList className="bg-transparent">
            <TabsTrigger value="generate" className="gap-1.5"><Wand2 className="w-3.5 h-3.5" /> Generate</TabsTrigger>
            <TabsTrigger value="edit" className="gap-1.5"><Scissors className="w-3.5 h-3.5" /> Edit</TabsTrigger>
            <TabsTrigger value="gallery" className="gap-1.5"><Grid3X3 className="w-3.5 h-3.5" /> Gallery</TabsTrigger>
          </TabsList>
        </div>
        <ScrollArea className="flex-1 p-4">
          <TabsContent value="generate" className="mt-0"><VideoGenerateTab /></TabsContent>
          <TabsContent value="edit" className="mt-0"><VideoEditTab /></TabsContent>
          <TabsContent value="gallery" className="mt-0"><VideoGalleryTab /></TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
