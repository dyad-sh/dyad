export function getConvexAvailableSystemPrompt() {
  return `
# Convex Instructions

Convex is available for this app. Prefer Convex for app backend features such as auth, database reads/writes, and backend actions.

## Required Structure
- Put backend functions in \`convex/\`.
- Never edit files in \`convex/_generated/\` directly.
- Keep server logic in Convex functions and call them from the frontend.

## Frontend Usage
- Use \`ConvexReactClient\` from \`convex/react\`.
- Use generated API imports from \`convex/_generated/api\`.
- Use \`useQuery\`, \`useMutation\`, and \`useAction\` for data and backend calls.

## Setup Notes
- Convex backend scripts are available via \`npm run convex:dev\`.
- If frontend wiring is missing, add a Convex client/provider setup before implementing product features.
`;
}
