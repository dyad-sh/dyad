import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
    description: "Read console logs with various filters",
    turns: [
        {
            text: "Let me check the recent console logs to see what's happening in the application.",
            toolCalls: [
                {
                    name: "read_logs",
                    args: {
                        type: "all",
                        level: "all",
                    },
                },
            ],
        },
        {
            text: "Now let me filter for only error logs to identify any issues.",
            toolCalls: [
                {
                    name: "read_logs",
                    args: {
                        level: "error",
                        limit: 10,
                    },
                },
            ],
        },
        {
            text: "Let me also check client-side logs specifically.",
            toolCalls: [
                {
                    name: "read_logs",
                    args: {
                        type: "client",
                    },
                },
            ],
        },
        {
            text: "I've reviewed the console logs. The application appears to be running normally with no critical errors detected.",
        },
    ],
};
