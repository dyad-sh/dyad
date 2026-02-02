import type { WindowsSignOptions } from "@electron/packager";
import type { HASHES } from "@electron/windows-sign/dist/esm/types";

export const windowsSign: WindowsSignOptions = {
  ...(process.env.SIGNTOOL_PATH
    ? { signToolPath: process.env.SIGNTOOL_PATH }
    : {}),
  signWithParams: `/v /debug /dlib ${process.env.AZURE_CODE_SIGNING_DLIB} /dmdf ${process.env.AZURE_METADATA_JSON}`,
  timestampServer: "http://timestamp.acs.microsoft.com",
  hashes: ["sha256" as HASHES],
};
