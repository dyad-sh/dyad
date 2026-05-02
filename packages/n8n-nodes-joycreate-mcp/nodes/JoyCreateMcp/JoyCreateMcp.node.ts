import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeOperationError,
} from "n8n-workflow";

/**
 * JoyCreate MCP node.
 *
 * Exposes the JoyCreate MCP Hub over HTTP so n8n workflows can:
 *   - list configured MCP servers
 *   - list tools (per server or the whole catalog)
 *   - call any tool from any server
 *   - list resources from a server
 *
 * All operations use the bearer-token-authenticated JSON API the
 * JoyCreate desktop app already exposes. No new transport layer is
 * required.
 */
export class JoyCreateMcp implements INodeType {
  description: INodeTypeDescription = {
    displayName: "JoyCreate MCP",
    name: "joyCreateMcp",
    icon: "file:joycreate.svg",
    group: ["transform"],
    version: 1,
    subtitle: "={{$parameter[\"operation\"]}}",
    description:
      "Invoke MCP tools or list servers/resources via the JoyCreate Hub.",
    defaults: {
      name: "JoyCreate MCP",
    },
    // n8n type system uses string union literals here; explicit casts keep
    // us out of the `as any` business.
    inputs: ["main"] as unknown as INodeTypeDescription["inputs"],
    outputs: ["main"] as unknown as INodeTypeDescription["outputs"],
    credentials: [
      {
        name: "joyCreateApi",
        required: true,
      },
    ],
    requestDefaults: {
      baseURL: "={{$credentials.serverUrl}}",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    },
    properties: [
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        options: [
          {
            name: "Call Tool",
            value: "callTool",
            action: "Call a tool on an MCP server",
            description:
              "Invoke a specific tool by server id and tool name with JSON arguments.",
          },
          {
            name: "List Tools",
            value: "listTools",
            action: "List available MCP tools",
            description:
              "List all tools across servers, or scope to a single server.",
          },
          {
            name: "List Servers",
            value: "listServers",
            action: "List configured MCP servers",
          },
          {
            name: "List Resources",
            value: "listResources",
            action: "List resources exposed by a server",
          },
        ],
        default: "callTool",
      },

      // ── Server ID (used by callTool / listResources / optional listTools) ──
      {
        displayName: "Server ID",
        name: "serverId",
        type: "number",
        typeOptions: { minValue: 1 },
        default: 1,
        required: true,
        displayOptions: {
          show: {
            operation: ["callTool", "listResources"],
          },
        },
        description:
          "Numeric ID of the MCP server (visible in JoyCreate \u2192 MCP Hub). Use \"List Servers\" to discover IDs.",
      },
      {
        displayName: "Server ID (optional)",
        name: "serverIdOptional",
        type: "number",
        typeOptions: { minValue: 0 },
        default: 0,
        displayOptions: {
          show: {
            operation: ["listTools"],
          },
        },
        description:
          "Leave 0 to return the full cross-server tool catalog. Set to a server id to scope the listing.",
      },

      // ── callTool inputs ────────────────────────────────────────────
      {
        displayName: "Tool Name",
        name: "toolName",
        type: "string",
        default: "",
        required: true,
        displayOptions: {
          show: {
            operation: ["callTool"],
          },
        },
        description:
          "Bare tool name as exposed by the MCP server (e.g. \"create_issue\"). Do NOT include the `mcp__server__` prefix \u2014 that is for the LLM tool catalog only.",
      },
      {
        displayName: "Arguments (JSON)",
        name: "argsJson",
        type: "json",
        default: "{}",
        required: false,
        displayOptions: {
          show: {
            operation: ["callTool"],
          },
        },
        description:
          "JSON object passed as the tool arguments. Schema depends on the specific tool.",
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const operation = this.getNodeParameter("operation", i) as string;
      let endpoint = "";
      const body: Record<string, unknown> = {};

      try {
        switch (operation) {
          case "listServers":
            endpoint = "/api/mcp/list-servers";
            break;

          case "listTools": {
            endpoint = "/api/mcp/list-tools";
            const sid = this.getNodeParameter(
              "serverIdOptional",
              i,
              0,
            ) as number;
            if (sid && sid > 0) body.serverId = sid;
            break;
          }

          case "callTool": {
            endpoint = "/api/mcp/call-tool";
            const serverId = this.getNodeParameter("serverId", i) as number;
            const toolName = this.getNodeParameter("toolName", i) as string;
            const argsParam = this.getNodeParameter("argsJson", i, {}) as
              | string
              | Record<string, unknown>;
            let args: unknown = argsParam;
            // The `json` parameter can come back as a string when the user
            // hand-edits it in the UI. Parse defensively.
            if (typeof argsParam === "string") {
              try {
                args = argsParam.trim() === "" ? {} : JSON.parse(argsParam);
              } catch (err) {
                throw new NodeOperationError(
                  this.getNode(),
                  `Tool arguments are not valid JSON: ${(err as Error).message}`,
                  { itemIndex: i },
                );
              }
            }
            body.serverId = serverId;
            body.name = toolName;
            body.args = args;
            break;
          }

          case "listResources": {
            endpoint = "/api/mcp/list-resources";
            body.serverId = this.getNodeParameter("serverId", i) as number;
            break;
          }

          default:
            throw new NodeOperationError(
              this.getNode(),
              `Unknown operation: ${operation}`,
              { itemIndex: i },
            );
        }

        const response = await this.helpers.httpRequestWithAuthentication.call(
          this,
          "joyCreateApi",
          {
            method: "POST",
            url: endpoint,
            body,
            json: true,
          },
        );

        returnData.push({
          json: {
            operation,
            ...(response as Record<string, unknown>),
          },
          pairedItem: { item: i },
        });
      } catch (err) {
        if (this.continueOnFail()) {
          returnData.push({
            json: {
              operation,
              error: err instanceof Error ? err.message : String(err),
            },
            pairedItem: { item: i },
          });
          continue;
        }
        throw err;
      }
    }

    return [returnData];
  }
}
