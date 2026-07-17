import { z } from "zod";
import crypto from "node:crypto";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { safeSend } from "@/ipc/utils/safe_sender";
import { saveDesignInterface } from "@/ipc/utils/design_persistence";
import { DesignInterfaceDataSchema } from "@/ipc/types/design";

const logger = log.scope("design_interface");

const designInterfaceSchema = z.object({
  name: z
    .string()
    .describe("The screen name (matches an interface from the brief)"),
  purpose: z
    .string()
    .optional()
    .describe("One line on what this screen is for"),
  width: z
    .number()
    .positive()
    .describe("Canvas width in px (desktop ≈ 1440, mobile ≈ 390)"),
  height: z
    .number()
    .positive()
    .describe("Canvas height in px (desktop ≈ 1024, mobile ≈ 844)"),
  background: z
    .string()
    .describe("Frame background color (hex, or a CSS color)"),
  notes: z
    .string()
    .optional()
    .describe("Short note on the aesthetic intent and key copy decisions"),
  code: z
    .string()
    .min(1, "Provide the Konva drawing code")
    .describe(
      "JavaScript that draws the screen by adding Konva shapes to `layer`. See the tool description for the execution contract and an example.",
    ),
});

const DESCRIPTION = `Generate one interface (screen) by writing Konva drawing code that the app executes to render the mockup on a canvas in the preview panel.

Call this once per screen listed in the design brief, in order. Each call is a complete, self-contained mockup.

<execution>
Your "code" runs as the body of: new Function("Konva", "layer", "width", "height", code)
- "Konva" is the Konva library. Build shapes with its constructors (Konva.Rect, Konva.Text, Konva.Circle, Konva.Line, Konva.Group, …).
- "layer" is a Konva.Layer already added to a stage. Add every shape to it via layer.add(shape). The frame background is already painted for you.
- "width" and "height" are the canvas dimensions in px.
Do NOT create the Stage or Layer, do NOT call layer.draw(), do NOT reference the DOM/window or load external resources, and do NOT return a value. Just add shapes to "layer".
</execution>

<coordinates>
x/y are absolute pixels from the top-left of the canvas; keep shapes within the width/height bounds. Konva.Circle is center-anchored (x/y is its center). Konva.Line takes a flat points array [x1,y1,x2,y2,…] in absolute canvas coordinates.
</coordinates>

<fonts>
Set fontFamily to a font from the brief, spelled EXACTLY as the brief has it (e.g. "Inter Variable", "Instrument Serif"). Canvas text silently falls back to a default face for any unrecognized name, which ruins the screen — there is no error, it just looks wrong. Never invent a font name and never drop the "Variable" suffix.
</fonts>

<guidelines>
- Real, specific copy only — never lorem ipsum, "Button 1", or "Your headline here". Write what this product would actually ship.
- Build a real type scale. Display type at 56-120px against body at 15-16px; a screen where everything sits between 18px and 36px has no hierarchy. Always set lineHeight explicitly: 0.95-1.1 for display (Konva's default is much too loose and is the most common thing that makes a mockup look wrong), 1.5-1.6 for body.
- Constrain body text to a 480-680px width. Full-bleed paragraphs look unedited.
- 8pt grid. Generous page margins: 64-96px desktop, 20-24px mobile.
- Apply the accent color to the primary action and almost nothing else. Neutrals should carry the screen.
- Favor asymmetry and real negative space over a centered stack with everything filled in.
- Buttons: a filled Konva.Rect (with cornerRadius) plus a centered Konva.Text on top (align "center", verticalAlign "middle", width/height matching the rect).
- Media: a solid or subtly-tinted Konva.Rect in a palette neutral, with an optional quiet caption beside it. Do NOT use a dashed border with a centered image glyph — that reads as a wireframe, not a design.
- Icons: you cannot draw real ones. Unicode/emoji glyphs (▦ ★ ✓ → ⚡ 🔍) render inconsistently and are the loudest tell of generated design — do not put one on every card, nav item, or list row. Budget roughly two per screen. Prefer real geometry (Konva.Line for an arrow or chevron, Konva.Circle for a bullet or avatar) and prefer typography and space over symbols.
</guidelines>

<example>
Note what this example does: one 104px display line against 16px body (a ~6:1 scale), tight lineHeight on the display, an off-center editorial split rather than a centered stack, a solid neutral for the photo rather than a dashed wireframe box, a square-edged black CTA as a deliberate choice, and zero decorative glyphs.

{
  "name": "Landing page",
  "width": 1440, "height": 1024, "background": "#FAF8F5",
  "notes": "Thesis: a restaurant that behaves like a print cookbook — enormous light serif, oceans of margin, one photo doing all the work. The CTA is hard-edged black so it reads as a stamp, not a web button.",
  "code": "layer.add(new Konva.Text({ x: 96, y: 48, text: 'FRESHBITE', fontSize: 12, fontFamily: 'Inter Variable', fontStyle: '500', fill: '#1B1B1B', letterSpacing: 3 }));\\n['Menu', 'Hours', 'Book a table'].forEach((label, i) => {\\n  layer.add(new Konva.Text({ x: 1080 + i * 110, y: 48, text: label, fontSize: 13, fontFamily: 'Inter Variable', fill: '#6B6560' }));\\n});\\nlayer.add(new Konva.Line({ points: [96, 88, 1344, 88], stroke: '#E5DFD6', strokeWidth: 1 }));\\nlayer.add(new Konva.Text({ x: 96, y: 216, width: 600, text: 'Braised four hours. Eaten in twenty minutes.', fontSize: 104, fontFamily: 'Instrument Serif', fill: '#1B1B1B', lineHeight: 0.95 }));\\nlayer.add(new Konva.Text({ x: 96, y: 560, width: 480, text: 'A short menu that changes when the market does. We cook one thing properly rather than forty things quickly.', fontSize: 16, fontFamily: 'Inter Variable', fill: '#6B6560', lineHeight: 1.6 }));\\nconst cta = new Konva.Group();\\ncta.add(new Konva.Rect({ x: 96, y: 680, width: 208, height: 56, fill: '#1B1B1B', cornerRadius: 0 }));\\ncta.add(new Konva.Text({ x: 96, y: 680, width: 208, height: 56, text: 'Book a table', fontSize: 14, fontFamily: 'Inter Variable', fontStyle: '500', fill: '#FAF8F5', align: 'center', verticalAlign: 'middle', letterSpacing: 1 }));\\nlayer.add(cta);\\nlayer.add(new Konva.Rect({ x: 768, y: 216, width: 576, height: 720, fill: '#E5DFD6' }));\\nlayer.add(new Konva.Text({ x: 768, y: 952, text: 'Short rib, Tuesday service', fontSize: 12, fontFamily: 'Inter Variable', fill: '#9A938B' }));"
}
</example>`;

export const designInterfaceTool: ToolDefinition<
  z.infer<typeof designInterfaceSchema>
> = {
  name: "design_interface",
  description: DESCRIPTION,
  inputSchema: designInterfaceSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) => `Interface: ${args.name}`,

  buildXml: (args, isComplete) => {
    if (!args.name) return undefined;
    const name = escapeXmlAttr(args.name);
    return `<dyad-design-interface name="${name}" complete="${isComplete}"></dyad-design-interface>`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Designing interface: ${args.name}`);

    const data = DesignInterfaceDataSchema.parse({
      id: `iface_${crypto.randomUUID().slice(0, 8)}`,
      name: args.name,
      purpose: args.purpose,
      width: args.width,
      height: args.height,
      background: args.background,
      notes: args.notes,
      code: args.code,
    });

    safeSend(ctx.event.sender, "design:interface-update", {
      chatId: ctx.chatId,
      data,
    });

    // Mirror to `<appPath>/.dyad/designs/<chatId>.json` so the mockup survives
    // reloads. Best-effort: persistence failures are logged, not thrown.
    await saveDesignInterface(ctx.appPath, ctx.chatId, data);

    return `Interface "${data.name}" (${data.width}×${data.height}) rendered in the preview panel. Continue with the next screen from the brief, or stop if all screens are done.`;
  },
};
