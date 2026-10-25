import { listToolNames } from "@/packages/gbd-mcp/client";
import { gbdEnv } from "@/infrastructure/env";

export type GbdStatusPorts = {
  readonly configured: () => boolean;
  readonly listToolNames: () => Promise<string[]>;
};

const defaultPorts = (): GbdStatusPorts => ({
  configured: () => gbdEnv() !== null,
  listToolNames,
});

export const getGbdStatusResponse = async (
  ports: Partial<GbdStatusPorts> = {},
): Promise<Response> => {
  const { configured, listToolNames: listNames } = {
    ...defaultPorts(),
    ...ports,
  };

  if (!configured()) {
    return Response.json({ configured: false });
  }

  try {
    const tools = await listNames();
    return Response.json({ configured: true, state: "ok", tools });
  } catch {
    return Response.json({ configured: true, state: "error" });
  }
};
