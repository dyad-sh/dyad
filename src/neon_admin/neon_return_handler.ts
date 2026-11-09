import { writeSettings } from "../main/settings";

export function handleNeonOAuthReturn({
  token,
  refreshToken,
  expiresIn,
}: {
  token: string;
  refreshToken: string;
  expiresIn: number;
}) {
  // Replace only account credentials, clearing reconnectRequired. App/project
  // associations and database environment files must survive reauthentication.
  writeSettings({
    neon: {
      accessToken: {
        value: token,
      },
      refreshToken: {
        value: refreshToken,
      },
      expiresIn,
      tokenTimestamp: Math.floor(Date.now() / 1000),
    },
  });
}
