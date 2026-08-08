interface SelectionPositionRect {
  right: number;
  top: number;
  width: number;
  height: number;
}

interface SelectionPositionRange {
  getBoundingClientRect(): SelectionPositionRect;
  getClientRects(): ArrayLike<SelectionPositionRect>;
}

export function getSelectionCommentAnchorRect(
  range: SelectionPositionRange,
): SelectionPositionRect {
  const clientRects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 || rect.height > 0,
  );

  return clientRects[clientRects.length - 1] ?? range.getBoundingClientRect();
}
