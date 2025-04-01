# Build an Agent

> **Pre-requisite:** please read [Agents & Tools user guide](../features/agents.md) first to understand how agents and tools work from a user perspective.

You will learn how to build a couple of simple agents in a few lines of code.

## Creating a haiku agent

Let's start by creating a simple agent to show the high-level structure of an agent. Copy the following code into a file like `haiku_agent.py`:

```python title="haiku_agent.py"
--8<-- "examples/haiku_agent.py"
```

Then, start Dyad with the following command:

```shell
dyad --extension=./haiku_agent.py
```

If you type in: "@" in the chat input, you should see "@haiku" as one of the chat suggestions. Then, type in a prompt like "tell me a joke" and see what you get back.

> Tip: If you hit an error, make sure that the path to the extension module is correct.

Let's explain this code example step-by-step:

1. `import dyad` should always be used instead of importing from specific sub-modules (e.g. `import dyad.foo`) because it's the only public API which will be stable over releases.
1. `@dyad.agent(name="haiku")` is a function decorator which makes a function into an agent. The `name` argument is what is shown in the chat suggestion.
1. The function parameter `context` is of the type `dyad.AgentContext` this contains the user input and state and represents essentially the interaction with an agent.
1. `yield from context.stream_to_content` is a method on AgentContext which allows you to call an LLM and incrementally update the UI.

## Creating a tools agent

Oftentimes, you will want to create an agent which can call various [tools](./build-a-tool.md). You can write a tool-calling agent in just a dozen lines.

Here's an example of a simple agent that selects between multiple tools:

```python title="Greetings agent"
--8<-- "examples/agents/hello-world/src/hello_world/agent.py"
```

And that's it! In a few lines, you created your own agent assembled with multiple tools.

## Next steps

Next, let's learn how to build a new tool:

[Build a tool](./build-a-tool.md){.next-step}
