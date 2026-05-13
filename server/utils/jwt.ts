import jwt from "jsonwebtoken";

const secret = process.env.JWT_SECRET;
if (!secret) {
  throw new Error(
    "JWT_SECRET environment variable is required. " +
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" " +
    "then set it in your .env file or docker-compose.yml.",
  );
}

export const jwtSecret: string = secret;

/** Verify a JWT and return the userId, or null if invalid/expired. */
export function verifyToken(token: string): { userId: string } | null {
  try {
    const payload = jwt.verify(token, jwtSecret) as { sub: string };
    return { userId: payload.sub };
  } catch {
    return null;
  }
}
