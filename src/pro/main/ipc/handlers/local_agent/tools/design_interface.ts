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

<guidelines>
- Use real, specific copy — never lorem ipsum or "Button 1". Write the actual product copy.
- Establish clear hierarchy: header/nav, primary content, and an obvious primary action.
- Reuse the brief's palette and fonts consistently. Set fontFamily to a web font from the brief.
- Give elements breathing room; think in a grid; avoid unintended overlaps.
- Buttons: a filled Konva.Rect (with cornerRadius) plus a centered Konva.Text on top (align "center", verticalAlign "middle", width/height matching the rect).
- Media: draw a placeholder — a dashed Konva.Rect plus a short centered label (e.g. "▦  Hero photo").
</guidelines>

<example>
{
  "name": "Landing page",
  "width": 1440, "height": 1024, "background": "#FFFDF9",
  "notes": "Editorial hero with a warm photo and a single clear CTA.",
  "code": "layer.add(new Konva.Rect({ x: 0, y: 0, width: width, height: 72, fill: '#FFFFFF' }));\nlayer.add(new Konva.Text({ x: 48, y: 24, text: 'FreshBite', fontSize: 22, fontFamily: 'Poppins', fontStyle: 'bold', fill: '#E85D04' }));\nlayer.add(new Konva.Text({ x: 48, y: 220, width: 620, text: 'Fresh, fast, unforgettable.', fontSize: 56, fontFamily: 'Poppins', fontStyle: 'bold', fill: '#1B1B1B', lineHeight: 1.1 }));\nlayer.add(new Konva.Text({ x: 48, y: 320, width: 560, text: 'Order your favorite dishes in a few taps.', fontSize: 20, fontFamily: 'Inter', fill: '#5A5A5A' }));\nconst cta = new Konva.Group();\ncta.add(new Konva.Rect({ x: 48, y: 400, width: 200, height: 56, fill: '#E85D04', cornerRadius: 12 }));\ncta.add(new Konva.Text({ x: 48, y: 400, width: 200, height: 56, text: 'Start an order', fontSize: 16, fontFamily: 'Inter', fontStyle: 'bold', fill: '#FFFFFF', align: 'center', verticalAlign: 'middle' }));\nlayer.add(cta);\nlayer.add(new Konva.Rect({ x: 760, y: 140, width: 632, height: 740, cornerRadius: 24, fill: '#EEF0F3', stroke: '#C3C8D0', strokeWidth: 1.5, dash: [8, 6] }));\nlayer.add(new Konva.Text({ x: 760, y: 140, width: 632, height: 740, text: '▦  Hero photo', fontSize: 16, fontFamily: 'Inter', fill: '#6B7280', align: 'center', verticalAlign: 'middle' }));"
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
