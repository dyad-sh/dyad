import { ipc } from "@/ipc/types";
import { DyadErrorKind } from "@/errors/dyad_error";
import { getAppPort } from "../../shared/ports";

import { v4 as uuidv4 } from "uuid";

function isAlreadyLinkedNeonProjectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { kind?: unknown }).kind === DyadErrorKind.Precondition &&
    (error as { message?: unknown }).message ===
      "This app already has a Neon project linked. Disconnect it first."
  );
}

export async function neonTemplateHook({
  appId,
  appName,
}: {
  appId: number;
  appName: string;
}) {
  console.log("Creating Neon project");
  let connectionString: string;
  try {
    const neonProject = await ipc.neon.createProject({
      name: appName,
      appId: appId,
    });
    connectionString = neonProject.connectionString;
    console.log("Neon project created", neonProject);
  } catch (error) {
    if (!isAlreadyLinkedNeonProjectError(error)) throw error;
    const branchEnvVars = await ipc.neon.getBranchEnvVars({
      appId,
      branchType: "development",
    });
    connectionString = branchEnvVars.databaseUrl;
    console.log("Resuming setup for existing Neon project");
  }

  await ipc.misc.setAppEnvVars({
    appId: appId,
    envVars: [
      {
        key: "POSTGRES_URL",
        value: connectionString,
      },
      {
        key: "PAYLOAD_SECRET",
        value: uuidv4(),
      },
      {
        key: "NEXT_PUBLIC_SERVER_URL",
        value: `http://localhost:${getAppPort(appId)}`,
      },
      {
        key: "GMAIL_USER",
        value: "example@gmail.com",
      },
      {
        key: "GOOGLE_APP_PASSWORD",
        value: "GENERATE AT https://myaccount.google.com/apppasswords",
      },
    ],
  });
  console.log("App env vars set");
}
