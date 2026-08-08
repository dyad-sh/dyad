export type WindowRectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function centeredBounds(
  workArea: WindowRectangle,
  width: number,
  height: number,
): WindowRectangle {
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  };
}

export function getPortraitWindowBounds(
  workArea: WindowRectangle,
): WindowRectangle {
  const height = Math.max(700, Math.min(1_050, workArea.height - 32));
  const width = Math.max(640, Math.min(760, workArea.width - 32, height - 80));
  return centeredBounds(workArea, width, height);
}

export function getLandscapeWindowBounds(
  workArea: WindowRectangle,
): WindowRectangle {
  const width = Math.max(800, Math.min(1_280, workArea.width - 32));
  const height = Math.max(
    600,
    Math.min(800, workArea.height - 32, width - 120),
  );
  return centeredBounds(workArea, width, height);
}
