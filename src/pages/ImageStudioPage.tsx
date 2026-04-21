/**
 * Image Studio — AI image generation, editing, and management
 *
 * Features:
 * - Text-to-image generation (DALL-E, Stable Diffusion, local models)
 * - Image-to-image editing (inpainting, outpainting, style transfer)
 * - Image upscaling and enhancement
 * - Gallery with tagging and search
 * - Batch generation
 * - Asset management for apps and marketplace
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
  ImageIcon, Wand2, Sparkles, Download, Upload, Search,
  Grid3X3, Layers, Palette, Maximize, Paintbrush,
  RefreshCw, Trash2, Heart, Tag, FolderOpen, Zap,
  Settings, ArrowUpRight, Copy,
} from "lucide-react";

function GenerateTab() {
  const [prompt, setPrompt] = useState("");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Controls */}
      <div className="space-y-4">
        <div>
          <Label className="text-xs">Prompt</Label>
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="A futuristic cityscape at sunset with flying cars and holographic billboards..." className="mt-1" rows={4} />
        </div>
        <div>
          <Label className="text-xs">Negative Prompt</Label>
          <Textarea placeholder="blurry, low quality, distorted, watermark..." className="mt-1" rows={2} />
        </div>
        <div>
          <Label className="text-xs">Model</Label>
          <Select defaultValue="sd-xl">
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="dall-e-3">DALL-E 3</SelectItem>
              <SelectItem value="sd-xl">Stable Diffusion XL</SelectItem>
              <SelectItem value="sd-3">Stable Diffusion 3</SelectItem>
              <SelectItem value="flux">FLUX.1</SelectItem>
              <SelectItem value="local">Local Model (ComfyUI)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Size</Label>
            <Select defaultValue="1024x1024">
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="512x512">512×512</SelectItem>
                <SelectItem value="768x768">768×768</SelectItem>
                <SelectItem value="1024x1024">1024×1024</SelectItem>
                <SelectItem value="1024x1792">1024×1792</SelectItem>
                <SelectItem value="1792x1024">1792×1024</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Batch Size</Label>
            <Select defaultValue="1">
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 image</SelectItem>
                <SelectItem value="2">2 images</SelectItem>
                <SelectItem value="4">4 images</SelectItem>
                <SelectItem value="8">8 images</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label className="text-xs">Guidance Scale: 7.5</Label>
          <Slider defaultValue={[7.5]} min={1} max={20} step={0.5} className="mt-2" />
        </div>
        <div>
          <Label className="text-xs">Steps: 30</Label>
          <Slider defaultValue={[30]} min={10} max={100} step={1} className="mt-2" />
        </div>
        <div>
          <Label className="text-xs">Seed (optional)</Label>
          <Input placeholder="Random" className="mt-1" />
        </div>
        <Button className="w-full" onClick={() => toast.info("Generating image...")}>
          <Wand2 className="w-4 h-4 mr-1.5" /> Generate
        </Button>
      </div>

      {/* Preview */}
      <div className="lg:col-span-2">
        <Card className="bg-muted/10 border-border/30 h-full min-h-[400px] flex items-center justify-center">
          <div className="text-center">
            <ImageIcon className="w-16 h-16 mx-auto mb-4 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/40">Generated images will appear here</p>
            <p className="text-[10px] text-muted-foreground/30 mt-1">Enter a prompt and click Generate</p>
          </div>
        </Card>
      </div>
    </div>
  );
}

function GalleryTab() {
  const mockImages = Array.from({ length: 12 }, (_, i) => ({
    id: `img-${i}`,
    prompt: `Sample image ${i + 1}`,
    model: i % 2 === 0 ? "DALL-E 3" : "SD XL",
    size: "1024×1024",
    createdAt: new Date(Date.now() - i * 3600000).toISOString(),
  }));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <Input placeholder="Search by prompt, tag, or model..." className="pl-10 h-8 text-xs" />
        </div>
        <Select defaultValue="all">
          <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Models</SelectItem>
            <SelectItem value="dall-e-3">DALL-E 3</SelectItem>
            <SelectItem value="sd-xl">SD XL</SelectItem>
            <SelectItem value="flux">FLUX</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {mockImages.map(img => (
          <Card key={img.id} className="bg-muted/10 border-border/30 group cursor-pointer hover:border-primary/30 transition-colors">
            <div className="aspect-square bg-gradient-to-br from-violet-500/20 to-pink-500/20 rounded-t-lg flex items-center justify-center">
              <ImageIcon className="w-8 h-8 text-muted-foreground/20" />
            </div>
            <CardContent className="p-2">
              <p className="text-[10px] text-muted-foreground/60 truncate">{img.prompt}</p>
              <div className="flex items-center justify-between mt-1">
                <Badge variant="outline" className="text-[8px]">{img.model}</Badge>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0"><Download className="w-3 h-3" /></Button>
                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0"><Copy className="w-3 h-3" /></Button>
                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0"><Trash2 className="w-3 h-3" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function EditTab() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Inpainting", desc: "Edit parts of an image", icon: <Paintbrush className="w-5 h-5" /> },
          { label: "Outpainting", desc: "Extend image boundaries", icon: <Maximize className="w-5 h-5" /> },
          { label: "Upscale", desc: "Enhance resolution (2x/4x)", icon: <ArrowUpRight className="w-5 h-5" /> },
          { label: "Style Transfer", desc: "Apply artistic styles", icon: <Palette className="w-5 h-5" /> },
          { label: "Background Remove", desc: "Remove/replace background", icon: <Layers className="w-5 h-5" /> },
          { label: "Color Correction", desc: "Adjust colors and lighting", icon: <Sparkles className="w-5 h-5" /> },
          { label: "Variation", desc: "Generate similar images", icon: <Grid3X3 className="w-5 h-5" /> },
          { label: "Img2Img", desc: "Transform with prompt", icon: <RefreshCw className="w-5 h-5" /> },
        ].map(tool => (
          <Button key={tool.label} variant="outline" className="h-auto py-4 flex-col gap-2" onClick={() => toast.info(`Opening ${tool.label}...`)}>
            {tool.icon}
            <span className="text-xs font-medium">{tool.label}</span>
            <span className="text-[9px] text-muted-foreground/50">{tool.desc}</span>
          </Button>
        ))}
      </div>
      <Card className="bg-muted/10 border-border/30 min-h-[300px] flex items-center justify-center">
        <div className="text-center">
          <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground/40">Drop an image here or click to upload</p>
          <p className="text-[10px] text-muted-foreground/30 mt-1">PNG, JPG, WebP up to 10MB</p>
        </div>
      </Card>
    </div>
  );
}

export default function ImageStudioPage() {
  const [activeTab, setActiveTab] = useState("generate");

  return (
    <div className="h-full flex flex-col">
      <div className="border-b p-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center">
            <ImageIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Image Studio</h1>
            <p className="text-sm text-muted-foreground">AI image generation, editing, and management</p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="border-b px-4">
          <TabsList className="bg-transparent">
            <TabsTrigger value="generate" className="gap-1.5"><Wand2 className="w-3.5 h-3.5" /> Generate</TabsTrigger>
            <TabsTrigger value="edit" className="gap-1.5"><Paintbrush className="w-3.5 h-3.5" /> Edit</TabsTrigger>
            <TabsTrigger value="gallery" className="gap-1.5"><Grid3X3 className="w-3.5 h-3.5" /> Gallery</TabsTrigger>
          </TabsList>
        </div>
        <ScrollArea className="flex-1 p-4">
          <TabsContent value="generate" className="mt-0"><GenerateTab /></TabsContent>
          <TabsContent value="edit" className="mt-0"><EditTab /></TabsContent>
          <TabsContent value="gallery" className="mt-0"><GalleryTab /></TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
