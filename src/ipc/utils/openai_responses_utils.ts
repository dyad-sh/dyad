export function usesOpenAIResponsesApiInLocalAgent(model: {
  provider: string;
  name: string;
}): boolean {
  return (
    model.provider === "openai" ||
    (model.provider === "auto" &&
      (model.name === "value" || model.name === "balanced"))
  );
}
