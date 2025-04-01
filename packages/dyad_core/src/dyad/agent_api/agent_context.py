"""
Agent context represents the input and state for a human-agent interaction.

Note: these are not persisted in the DB (and thus not Pydantic models).
"""

import inspect
import re
from collections.abc import Callable, Generator, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import (
    Any,
    Concatenate,
    TypeVar,
    get_type_hints,
)

from pydantic import BaseModel, Field
from typing_extensions import ParamSpec

from dyad.chat import LanguageModelRequest
from dyad.language_model.language_model import LanguageModelType
from dyad.language_model.language_model_clients import (
    get_core_language_model,
    get_editor_language_model,
    get_language_model_client,
    get_reasoner_language_model,
    get_router_language_model,
)
from dyad.logging.llm_calls import LanguageModelResponse, llm_call_logger
from dyad.logging.logging import logger
from dyad.pad import Pad
from dyad.pad_logic import has_matching_files
from dyad.prompts.prompts import get_default_system_prompt
from dyad.public.agent_step import (
    AgentStep,
    DefaultStep,
    ErrorStep,
    ToolCallStep,
    ToolId,
    set_get_tool_from_handler,
)
from dyad.public.chat_message import (
    AgentChunk,
    ChatMessage,
    CompletionMetadataChunk,
    Content,
    ErrorChunk,
    LanguageModelCallMetadata,
    TextChunk,
)
from dyad.public.input import Input
from dyad.storage.models.pad import (
    get_pad,
    get_pads_with_glob_pattern,
    get_pads_with_selection_instruction,
)
from dyad.workspace_util import read_workspace_file

ToolParams = ParamSpec("ToolParams", default=...)

ToolHandler = Callable[
    Concatenate["AgentContext", Content, ToolParams],
    Generator[None, None, Any],
]


@dataclass
class ToolArg:
    name: str
    type: type


def get_handler_params(handler: ToolHandler) -> list[ToolArg]:
    """
    Extract parameter information from a tool handler function.
    Returns a list of ToolArg containing parameter name and type.
    Excludes the RequestArgs parameter.
    """
    signature = inspect.signature(handler)
    type_hints = get_type_hints(handler)

    # Skip the first two parameters and collect the rest
    params: list[ToolArg] = []
    for name, _ in list(signature.parameters.items())[2:]:
        param_type = type_hints.get(name, type(None))
        params.append(ToolArg(name=name, type=param_type))

    return params


@dataclass
class Tool:
    id: ToolId
    description: str

    icon: str
    handler: ToolHandler
    max_uses: int = 1
    is_available: Callable[[], bool] | None = None
    tool_params: list[ToolArg] = field(init=False)
    instructions: str = field(init=False)

    def __post_init__(self):
        self.tool_params = get_handler_params(self.handler)
        self.instructions = self.handler.__doc__ or ""


@dataclass
class AgentObservation:
    content: str
    metadata: dict[str, str] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.now)


BaseModelType = TypeVar("BaseModelType", bound=BaseModel)


@dataclass
class AgentContext:
    # Public attributes:
    input: Input
    base_prompt: str = ""
    content: Content = field(default_factory=Content)

    # Private attributes:
    _history: list[ChatMessage] = field(default_factory=list, repr=False)
    _pad_ids: set[str] = field(default_factory=set)
    _used_pad_ids: set[str] = field(default_factory=set)
    _file_paths: set[str] = field(default_factory=set)
    _observed_files: dict[str, str] = field(default_factory=dict)
    _observations: list[AgentObservation] = field(default_factory=list)
    _language_model_ids: dict[LanguageModelType, str] = field(
        default_factory=lambda: {
            "core": get_core_language_model().id,
            "editor": get_editor_language_model().id,
            "reasoner": get_reasoner_language_model().id,
            "router": get_router_language_model().id,
        }
    )
    _tools: Sequence[Tool] = field(default_factory=list)
    _tool_use_counts: dict[str, int] = field(default_factory=dict)
    _hashtags: set[str] = field(default_factory=set)

    def _set_tools(self, tools: Iterable[ToolHandler]) -> None:
        self._tools = [get_tool_from_handler(tool) for tool in tools]
        self._tool_use_counts = {tool.id.tool_name: 0 for tool in self._tools}

    @property
    def _available_tools(self) -> dict[str, Tool]:
        return {
            tool.id.tool_name: tool
            for tool in self._tools
            if self._tool_use_counts[tool.id.tool_name] < tool.max_uses
            and (tool.is_available() if tool.is_available else True)
        }

    def stream_step(
        self,
        tools: Iterable[ToolHandler] | None = None,
    ) -> Generator[None, None, AgentStep]:
        """
        Calls the 'editor' language model to figure out if it should use a tool
        or provide a final answer. Returns the concatenated text response.
        """
        candidate_pads = get_pads_with_selection_instruction()
        if tools is not None:
            self._set_tools(tools)
        system_prompt = get_tool_use_prompt(
            tools=self._available_tools.values(),
            candidate_pads=candidate_pads,
        )
        tool_content = Content()
        tool_content.step = ToolCallStep(
            tool_id=INTERNAL_ROUTER_TOOL_ID,
            args={
                "pads": candidate_pads,
                "available_tools": list(self._available_tools.keys()),
            },
            rationale="Thinking about what to do next...",
        )
        self.content.add_child(tool_content)
        yield

        # Accumulate all chunks into a single string. You can also yield partial
        # chunks if you want streaming behavior.
        str_response = ""
        for chunk in self.stream_chunks(
            model_type="router",
            system_prompt=system_prompt,
            skip_observe_files=True,
        ):
            if isinstance(chunk, ErrorChunk):
                self.content.append_chunk(chunk)
                yield
                return ErrorStep(error_message=chunk.message)
            str_response += chunk.text
        logger().debug("Tool use: system_prompt: %s", system_prompt)
        logger().debug("Tool use: context.input: %s", self.input)
        logger().debug("Tool use: full_response: %s", str_response)

        output = parse_tool_use_response(str_response)
        selected_pads = [candidate_pads[i] for i in output.selected_pad_indices]
        selected_pads_title = ", ".join([p.title for p in selected_pads])
        tool_content.step.rationale = f"Selected pads: {selected_pads_title}, using tool: {output.tool} because of {output.rationale}"
        self.add_pad_ids([p.id for p in selected_pads])
        if (
            output.tool is None
            or output.tool.lower() == "none"
            or output.tool == ""
        ):
            return DefaultStep()
        tool_step = ToolCallStep(
            args=output.args,
            tool_id=self._get_tool_from_name(output.tool).id,
        )
        return_val = yield from self._use_tool(tool_step)
        tool_step.return_value = return_val
        return tool_step

    def _get_tool_from_name(self, name: str) -> Tool:
        for tool in self._tools:
            if tool.id.tool_name == name:
                return tool
        raise ValueError(f"Tool {name} not found")

    def call_tool(
        self,
        tool: ToolHandler[ToolParams],
        *args: ToolParams.args,
        **kwargs: ToolParams.kwargs,
    ) -> Generator[None, None, Any]:
        """
        Calls the specified tool with the given arguments and yields the
        generated content.
        """
        return self._use_tool(
            ToolCallStep(
                args=kwargs,
                tool_id=get_tool_from_handler(tool).id,
                rationale="Explicitly calling tool based on heuristics.",
            ),
            disable_available_tools_check=True,
        )

    def _use_tool(
        self,
        response: ToolCallStep,
        disable_available_tools_check: bool = False,
    ) -> Generator[None, None, None]:
        """
        Given the selected tool and arguments, run the tool and yield intermediate
        content blocks. If final content is produced, return immediately.
        """
        child_content = Content()
        self.content.add_child(child_content)
        yield
        tool_name = response.tool_id.tool_name
        if (
            not disable_available_tools_check
            and tool_name not in self._available_tools
        ):
            raise ValueError(
                f"Tool {tool_name} is not available or already used."
            )
        self.observe("OK, I'm using this tool: " + tool_name)
        # Get tool object, increment usage, remove from available if max uses is reached.
        # tool = self._available_tools[tool_name]
        tool = get_tool_from_id(response.tool_id)
        assert tool is not None
        current_uses = self._tool_use_counts.get(tool_name, 0)

        self._tool_use_counts[tool_name] = current_uses + 1
        child_content.step = response
        yield

        # Invoke the tool's handler and capture its return value.
        handler_gen = tool.handler(self, child_content, **(response.args or {}))
        result = None
        while True:
            try:
                next(handler_gen)
                child_content.internal_tool_render_id = tool.id
                # As new content is generated, remove the old "thinking" placeholder
                # and add the chunk to the new content to keep the tool usage link
                self.content.children.pop()
                self.content.children.append(child_content)
                yield
            except StopIteration as e:
                result = e.value
                break
        self.observe("OK I'm done using the tool: " + tool_name)
        if result is not None:
            self.observe("Here is the result of using the tool:")
            self.observe(repr(result))
        return result

    @property
    def hashtags(self) -> set[str]:
        return self._hashtags.copy()

    @property
    def history(self) -> Sequence[ChatMessage]:
        return [m for m in self._history]

    @history.setter
    def history(self, history: Sequence[ChatMessage]) -> None:
        raise NotImplementedError("History is not settable")

    def add_file_paths(self, file_paths: list[str] | set[str]):
        self._file_paths.update(file_paths)

    def observe_file_paths(self, file_paths: list[str] | set[str]):
        self.add_file_paths(file_paths)
        self._observe_files()

    def get_file_paths(self) -> set[str]:
        return self._file_paths.copy()

    def add_pad_ids(self, pad_ids: list[str]):
        self._pad_ids.update(pad_ids)

    def get_prompt(self) -> str:
        observations = "\n".join([obs.content for obs in self._observations])
        if observations:
            observations += "\n\n"
        new_pad_ids = self._pad_ids - self._used_pad_ids
        if new_pad_ids:
            observations += "\n\n ATTENTION! Here are some additional rules and instructions for you to follow\n"
        for pad_id in new_pad_ids:
            pad = get_pad(pad_id)
            if pad:
                observations += f"""<pad title="{pad.title}">
{pad.content}
</pad>
"""
        if observations:
            observations += "END OF RULES\n\n"
        return observations + self.input.text

    def observe(self, content: str, metadata: dict[str, str] | None = None):
        self._observations.append(
            AgentObservation(content=content, metadata=metadata or {})
        )

    def _observe_files(self) -> None:
        if self._file_paths - self._observed_files.keys():
            logger().info(
                f"Editing files with the following context: {self._file_paths}"
            )
            self.observe(
                "\n\nHere are some additional files for context (you don't necessarily need to edit these):\n"
            )
            pads = get_pads_with_glob_pattern()
            for pad in pads:
                assert pad.selection_criteria is not None
                assert pad.selection_criteria.type == "glob"
                if has_matching_files(
                    file_candidates=self._file_paths,
                    glob_pattern=pad.selection_criteria.glob_pattern,
                ):
                    self.add_pad_ids([pad.id])

            for file_path in sorted(self._file_paths):
                # Skip if we've already observed this file
                if file_path in self._observed_files:
                    continue
                try:
                    file_content = read_workspace_file(file_path)
                    self.observe(
                        f"""
```path="{file_path}"
{file_content}
```
"""
                    )
                    # Mark file as observed after successful observation
                    self._observed_files[file_path] = file_content
                except (OSError, FileNotFoundError):
                    # Skip if file doesn't exist or can't be read
                    continue

    def stream_chunks(
        self,
        *,
        content: Content | None = None,
        input: str | None = None,
        model_type: LanguageModelType = "core",
        system_prompt: str = "",
        skip_observe_files: bool = False,
    ) -> Generator[AgentChunk, None, None]:
        language_model_id = self._language_model_ids[model_type]
        client = get_language_model_client(language_model_id)
        if not skip_observe_files:
            self._observe_files()
        if content is None:
            content = get_last_content(self.content)

        # This is a little hack to figure out which model the auto model
        # will actually go to, so we can display, e.g. sonnet 3.5 instead of "core-auto".
        resolved_language_model_id = language_model_id
        if hasattr(client, "resolve_auto_model"):
            language_model = client.resolve_auto_model()  # type: ignore
            if language_model is not None:
                resolved_language_model_id = language_model.id
        content.metadata.calls.append(
            LanguageModelCallMetadata(
                language_model_id=resolved_language_model_id,
                started_at=datetime.now(),
            )
        )

        if self.base_prompt:
            self.base_prompt += "\n\n"
        request = LanguageModelRequest(
            input=Input.from_text(input or self.get_prompt()),
            history=self.history,
            system_prompt=self.base_prompt + system_prompt,
            language_model_id=language_model_id,
        )
        request_id = llm_call_logger().record_request(request)
        logger().debug(
            "Streaming chunks for request: %s using handler: %s",
            request,
            client,
        )
        response = LanguageModelResponse(chunks=[])
        for language_model_chunk in client.stream_chunks(request):
            response.chunks.append(language_model_chunk)
            if isinstance(language_model_chunk, TextChunk):
                yield language_model_chunk
            elif isinstance(language_model_chunk, ErrorChunk):
                # TODO: raise an exception instead of yielding this
                yield language_model_chunk
            elif isinstance(language_model_chunk, CompletionMetadataChunk):
                last_call = content.metadata.calls[-1]
                if not content.metadata.calls:
                    last_call = LanguageModelCallMetadata()
                    content.metadata.calls.append(last_call)
                    logger().warning(
                        "Did not receive a language call metadata for request: %s",
                        request,
                    )
                last_call.input_tokens_count = (
                    language_model_chunk.input_tokens_count
                )
                last_call.cached_input_tokens_count = (
                    language_model_chunk.cached_input_tokens_count
                )
                last_call.output_tokens_count = (
                    language_model_chunk.output_tokens_count
                )
                last_call.ended_at = datetime.now()
                last_call.finish_reason = language_model_chunk.finish_reason
            else:
                raise ValueError(f"Unknown chunk type: {language_model_chunk}")
        llm_call_logger().record_response(request_id, response)

    def stream_structured_output(
        self,
        output_type: type[BaseModelType],
        *,
        input: str | None = None,
        model_type: LanguageModelType = "router",
        system_prompt: str = "",
    ) -> Generator[BaseModelType, None, None]:
        language_model_id = self._language_model_ids[model_type]
        if self.base_prompt:
            self.base_prompt += "\n\n"
        request = LanguageModelRequest(
            input=Input.from_text(input or self.get_prompt()),
            history=self.history,
            system_prompt=self.base_prompt + system_prompt,
            language_model_id=language_model_id,
            output_type=output_type,
        )
        logger().debug(
            "Streaming chunks for request: %s using handler: %s",
            request,
            get_language_model_client(language_model_id),
        )
        return get_language_model_client(
            language_model_id
        ).stream_structured_output(request)

    def stream_to_content(
        self,
        *,
        content: Content | None = None,
        input: str | None = None,
        system_prompt: str | None = None,
        model_type: LanguageModelType = "core",
    ) -> Generator[None, None, None]:
        """
        Calls the 'core' model to generate a final response if no tools are used.
        Yields the streaming content.
        """
        if content is None:
            content = Content()
        self.content.children.append(content)
        yield

        if system_prompt is None:
            system_prompt = get_default_system_prompt()

        for chunk in self.stream_chunks(
            content=content,
            input=input,
            system_prompt=system_prompt,
            model_type=model_type,
        ):
            content.append_chunk(chunk)
            yield

    def _to_request(
        self,
        *,
        language_model_id: str,
        system_prompt: str = "",
    ) -> LanguageModelRequest:
        """Convert the agent request to a model request."""
        return LanguageModelRequest(
            input=Input.from_text(self.get_prompt()),
            history=self.history,
            system_prompt=system_prompt,
            language_model_id=language_model_id,
        )


def get_last_content(content: Content) -> Content:
    if content.children:
        return get_last_content(content.children[-1])
    return content


_render_id_to_fn: dict[ToolId, Callable[[Content], None] | None] = {}


def get_render(id: ToolId) -> Callable[[Content], None] | None:
    return _render_id_to_fn.get(id)


_tool_handler_to_tool: dict[ToolHandler, Tool] = {}

INTERNAL_ROUTER_TOOL_ID = ToolId(
    package_name="dyad",
    tool_name="__router__",
)

_tool_id_to_tool: dict[str, Tool] = {
    str(INTERNAL_ROUTER_TOOL_ID): Tool(
        id=INTERNAL_ROUTER_TOOL_ID,
        description="Thinking about what to do next...",
        icon="router",
        handler=lambda: None,  # type: ignore
        max_uses=1,
    )
}


def get_tool_from_handler(handler: ToolHandler) -> Tool:
    return _tool_handler_to_tool[handler]


def get_tool_from_id(id: ToolId) -> Tool | None:
    return _tool_id_to_tool.get(str(id))


set_get_tool_from_handler(get_tool_from_handler)


def tool(
    *,
    description: str,
    icon: str = "handyman",
    name: str | None = None,
    render: Callable[[Content], None] | None = None,
    is_available: Callable[[], bool] | None = None,
    max_uses: int = 1,
) -> Callable[[ToolHandler[ToolParams]], ToolHandler[ToolParams]]:
    """
    Decorator function to create and register a tool.

    Args:
        description: Description of what the tool does
        icon: Icon identifier for the tool
        render: Optional render function to be called when the content generated by the tool is displayed
        is_available: Optional function to determine if the tool is available based on the context
        max_uses: Maximum number of times this tool can be used (default: 1)
    Returns:
        Decorator function that creates a Tool instance
    """

    def decorator(func: ToolHandler) -> ToolHandler:
        tool_id = ToolId(
            package_name=func.__module__.split(".")[0],
            tool_name=name or func.__name__,
        )
        if render:
            _render_id_to_fn[tool_id] = render

        tool = Tool(
            id=tool_id,
            description=description,
            icon=icon,
            handler=func,
            is_available=is_available,
            max_uses=max_uses,
        )
        _tool_handler_to_tool[func] = tool
        if str(tool_id) in _tool_id_to_tool:
            logger().warning("Tool with id %s already registered", tool_id)
        _tool_id_to_tool[str(tool_id)] = tool
        return func

    return decorator


class ToolUseResponse(BaseModel):
    rationale: str | None = None
    selected_pad_indices: list[int] = []
    args: dict[str, Any] = Field(default_factory=dict)
    tool: str | None


def parse_tool_use_response(response: str) -> ToolUseResponse:
    try:
        parsed_response = re.search(
            r"<rationale>(.*?)</rationale>", response, re.DOTALL
        )
        rationale = parsed_response.group(1) if parsed_response else None

        parsed_tool = re.search(r"<tool>(.*?)</tool>", response, re.DOTALL)
        tool = parsed_tool.group(1) if parsed_tool else None

        selected_pad_indices: list[int] = []
        pad_matches = re.finditer(
            r"<pad-id>(.*?)</pad-id>", response, re.DOTALL
        )
        for match in pad_matches:
            pad_index = int(match.group(1).strip())
            selected_pad_indices.append(pad_index)

        args: dict[str, Any] = {}
        if "<args>" in response:
            args_section = re.search(r"<args>(.*?)</args>", response, re.DOTALL)
            if args_section:
                args_text = args_section.group(1)
                arg_matches = re.finditer(
                    r'<arg name="([^"]+)">(.*?)</arg>', args_text, re.DOTALL
                )
                for match in arg_matches:
                    arg_name = match.group(1)
                    arg_value = match.group(2)
                    args[arg_name] = arg_value.strip()
        if tool is None:
            return ToolUseResponse(
                rationale=rationale,
                tool=None,
                selected_pad_indices=selected_pad_indices,
            )

        return ToolUseResponse(
            rationale=rationale,
            tool=tool,
            args=args,
            selected_pad_indices=selected_pad_indices,
        )
    except AttributeError:
        # If parsing fails, return a default response
        return ToolUseResponse(
            rationale="Failed to parse response",
            tool=None,
            selected_pad_indices=[],
        )


def get_tool_use_prompt(
    tools: Iterable[Tool], candidate_pads: Iterable[Pad]
) -> str:
    # Format each tool with its name, instructions, and parameters
    tool_descriptions: list[str] = []
    for tool in tools:
        params = [
            f"{param.name}: {param.type.__name__}" for param in tool.tool_params
        ]
        param_str = f" (Parameters: {', '.join(params)})" if params else ""
        tool_descriptions.append(
            f'- <tool-definition name="{tool.id.tool_name}">{param_str}: {tool.instructions}</tool-definition>'
        )

    tool_list = "\n".join(tool_descriptions)

    return f"""
Determine whether or not additional tools are needed to answer the user's query.
                                 
These are the tools:

{tool_list}

Do NOT use a tool unless you need it. If the user is asking a generic question and is NOT looking

If a user has *already* used a tool, then you do not need to use it again unless it's REALLY necessary.

Return it in the following format:

<rationale>$rationale</rationale>                                 
<tool>$tool_name</tool>
<args>
    <arg name="param_name1">value1</arg>
    <arg name="param_name2">value2</arg>
</args>

Each parameter should be provided as an arg tag with a name attribute.

---

<example>
<input>Tell me a haiku</input>

<output>
<rationale>I do not need to use any tools</rationale>                                 
</output>
</example>

---

<example>
<input>tell me a joke</input>
<output>
<rationale>user wants a joke</rationale>                                 
<tool>joke_generator</tool>
<args>
    <arg name="query">main.py</arg>
</args>
</output>
</example>
""" + (pads_prompt(candidate_pads) if candidate_pads else "")


def pads_prompt(candidate_pads: Iterable[Pad]):
    pads = "\n".join(
        [
            f'- <pad id="{index}">Selection criteria: {pad.selection_criteria}</pad>'
            for index, pad in enumerate(candidate_pads)
        ]
    )

    return f"""
You will also need to tell me which pads, if any, should be used to answer the query.

Do not use any pads unless you need them.

Here are the pads that can be used to answer the query:

{pads}

Expected output:

<pad-id>1</pad-id>
<pad-id>2</pad-id>

If no pads are needed, then do not return any pad-ids.
"""
