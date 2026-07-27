import { useEffect, useState, type PropsWithChildren } from "react";
import { IpcRemoteMachineConnection } from "@/distributed_machines/ipc_connection";
import { RemoteMachineProvider } from "@/distributed_machines/react";
import { uuidIdSource } from "@/state_machines/clock";

export function GithubOpsProvider({ children }: PropsWithChildren) {
  const [connection] = useState(() => new IpcRemoteMachineConnection());

  useEffect(() => connection.start(), [connection]);

  return (
    <RemoteMachineProvider connection={connection} ids={uuidIdSource}>
      {children}
    </RemoteMachineProvider>
  );
}
