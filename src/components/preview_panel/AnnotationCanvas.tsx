import React from "react";
import {
  Stage,
  Layer,
  Image as KonvaImage,
  Path,
  Text,
  Transformer,
} from "react-konva";
import { getStroke } from "perfect-freehand";

// Helper to convert stroke points to SVG path data
function getSvgPathFromStroke(stroke: number[][]) {
  if (!stroke.length) return "";
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...stroke[0], "Q"],
  );
  d.push("Z");
  return d.join(" ");
}

type Point = [number, number];
type Shape =
  | {
      id: string;
      type: "line";
      points: Point[];
      color: string;
      size: number;
      isComplete: boolean;
    }
  | {
      id: string;
      type: "text";
      x: number;
      y: number;
      text: string;
      fontSize: number;
      color: string;
    };

interface AnnotationCanvasProps {
  image: HTMLImageElement | null;
  shapes: Shape[];
  selectedId: string | null;
  tool: "select" | "draw" | "text";
  scale: number;
  stageDimensions: { width: number; height: number };
  containerSize: { width: number; height: number };
  stageRef: React.RefObject<any>;
  transformerRef: React.RefObject<any>;
  onMouseDown: (e: any) => void;
  onMouseMove: (e: any) => void;
  onMouseUp: () => void;
  onShapeSelect: (id: string) => void;
  onShapeDragEnd: (id: string, x: number, y: number) => void;
}

export const AnnotationCanvas = ({
  image,
  shapes,
  selectedId,
  tool,
  scale,
  stageDimensions,
  containerSize,
  stageRef,
  transformerRef,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onShapeSelect,
  onShapeDragEnd,
}: AnnotationCanvasProps) => {
  if (!image || containerSize.width === 0) {
    return null;
  }

  return (
    <div className="w-full h-full">
      <Stage
        width={stageDimensions.width}
        height={stageDimensions.height}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onTouchStart={onMouseDown}
        onTouchMove={onMouseMove}
        onTouchEnd={onMouseUp}
        ref={stageRef}
        style={{ touchAction: "none" }}
      >
        <Layer>
          <KonvaImage
            image={image}
            listening={false}
            scaleX={scale}
            scaleY={scale}
          />
          {shapes.map((shape) => {
            if (shape.type === "line") {
              const stroke = getStroke(shape.points, {
                size: shape.size,
                thinning: 0.5,
                smoothing: 0.5,
                streamline: 0.5,
              });
              const pathData = getSvgPathFromStroke(stroke);
              return (
                <Path
                  key={shape.id}
                  id={shape.id}
                  data={pathData}
                  fill={shape.color}
                  scaleX={scale}
                  scaleY={scale}
                  onClick={() => tool === "select" && onShapeSelect(shape.id)}
                  onTap={() => tool === "select" && onShapeSelect(shape.id)}
                  draggable={tool === "select"}
                />
              );
            } else if (shape.type === "text") {
              return (
                <Text
                  key={shape.id}
                  id={shape.id}
                  x={shape.x}
                  y={shape.y}
                  scaleX={scale}
                  scaleY={scale}
                  text={shape.text}
                  fontSize={shape.fontSize * scale}
                  fill={shape.color}
                  draggable={tool === "select"}
                  onClick={() => tool === "select" && onShapeSelect(shape.id)}
                  onTap={() => tool === "select" && onShapeSelect(shape.id)}
                  onDragEnd={(e) => {
                    const node = e.target;
                    onShapeDragEnd(shape.id, node.x(), node.y());
                  }}
                />
              );
            }
            return null;
          })}
          {selectedId && (
            <Transformer
              ref={transformerRef}
              boundBoxFunc={(oldBox, newBox) => {
                // Limit resize if needed
                if (newBox.width < 5 || newBox.height < 5) {
                  return oldBox;
                }
                return newBox;
              }}
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
};
