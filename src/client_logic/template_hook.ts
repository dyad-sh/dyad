import { IpcClient } from "@/ipc/ipc_client";

import { v4 as uuidv4 } from "uuid";

export async function neonTemplateHook({
  appId,
  appName,
}: {
  appId: number;
  appName: string;
}) {
  console.log("Creating Neon project");
  const neonProject = await IpcClient.getInstance().createNeonProject({
    name: appName,
    appId: appId,
  });

  console.log("Neon project created", neonProject);
  await IpcClient.getInstance().setAppEnvVars({
    appId: appId,
    envVars: [
      {
        key: "POSTGRES_URL",
        value: neonProject.connectionString,
      },
      {
        key: "PAYLOAD_SECRET",
        value: uuidv4(),
      },
    ],
  });
  console.log("App env vars set");
}
