const fileSaveQueueByPath = new Map<string, Promise<void>>();

export function getFileSaveQueueKey(appId: number, filePath: string) {
  return `${appId}:${filePath}`;
}

export async function enqueueFileSave<T>(
  queueKey: string,
  saveOperation: () => Promise<T>,
) {
  const previousSave = fileSaveQueueByPath.get(queueKey) ?? Promise.resolve();
  const queuedSave = previousSave.catch(() => undefined).then(saveOperation);
  const trackedSave = queuedSave.then(
    () => undefined,
    () => undefined,
  );

  fileSaveQueueByPath.set(queueKey, trackedSave);

  try {
    return await queuedSave;
  } finally {
    if (fileSaveQueueByPath.get(queueKey) === trackedSave) {
      fileSaveQueueByPath.delete(queueKey);
    }
  }
}
