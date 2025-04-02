import functools
from collections.abc import Callable
from dataclasses import field
from datetime import datetime
from functools import partial
from typing import Any

import mesop as me
import mesop.labs as mel
from dyad import logger
from dyad.agent_api.agent_context import (
    INTERNAL_ROUTER_TOOL_ID,
    get_render,
    get_tool_from_id,
)
from dyad.language_model.language_model_clients import (
    get_language_model,
    get_next_provider_model,
)
from dyad.public.agent_step import ToolCallStep
from dyad.public.chat_message import (
    ChatMessage,
    Checkpoint,
    Content,
    ContentError,
)
from dyad.settings.user_settings import get_user_settings
from dyad.storage.models.pad import get_pad
from dyad.ui_proxy.ui_actions import set_markdown_proxy

from dyad_app.academy.academy_util import ACADEMY_BASE_URL
from dyad_app.logic.apply_code import (
    FileEdit,
    apply_all_code_changes,
    orchestrate_apply_code,
)
from dyad_app.logic.chat_files import (
    does_content_have_files,
)
from dyad_app.logic.chat_logic import (
    click_update_edit_message,
    regenerate_response,
    submit_follow_up_prompt,
)
from dyad_app.logic.revert_code import propose_revert_to_checkpoint
from dyad_app.ui.chat.message_parser import (
    AcademyCollection,
    FollowUpPrompts,
    ParsedSegment,
    TextContent,
    parse_content_with_pad,
)
from dyad_app.ui.helper import (
    icon_button,
)
from dyad_app.ui.home_page_utils import CHAT_MAX_WIDTH
from dyad_app.ui.side_pane_state import set_side_pane
from dyad_app.ui.state import (
    Pad,
    State,
)
from dyad_app.web_components.copy_to_clipboard import write_to_clipboard
from dyad_app.web_components.loading_block import loading_block
from dyad_app.web_components.markdown import markdown


def chat_pane():
    state = me.state(State)

    with me.box(
        style=me.Style(
            background=me.theme_var("surface-container-lowest"),
            color=me.theme_var("on-surface"),
            display="flex",
            flex_direction="column",
            margin=me.Margin.symmetric(horizontal="auto"),
            padding=me.Padding.all(15),
            min_width=0,
            max_width=CHAT_MAX_WIDTH,
            line_height=1.5,
        )
    ):
        for index, turn in enumerate(state.current_chat.turns):
            msg = turn.current_message
            if msg.role == "user":
                user_message(message=msg, turn_index=index)
            else:
                assistant_message(
                    turn_index=index,
                    message=msg,
                    is_last_turn=index == len(state.current_chat.turns) - 1,
                )

        me.box(
            key="chat-bottom-viewport-intersection-target",
            style=me.Style(height=4, margin=me.Margin(top=-200), z_index=-1),
        )
        me.box(
            key="scroll-to-bottom-target",
            style=me.Style(height="20px"),
        )


def user_message(*, message: ChatMessage, turn_index: int):
    with me.box(
        style=me.Style(
            display="flex",
            flex_direction="column",
            align_items="flex-end",
            margin=me.Margin.all(20),
        )
    ):
        with me.box(
            style=me.Style(
                background=me.theme_var("surface-container-low"),
                border_radius=10,
                color=me.theme_var("on-surface-variant"),
                padding=me.Padding.symmetric(vertical=0, horizontal=10),
                width="66%",
            )
        ):
            if message._is_editing:
                me.textarea(
                    value=message.content.get_text(),
                    style=me.Style(width="100%", padding=me.Padding(top=16)),
                    on_blur=partial(
                        on_blur_edit_message, turn_index=turn_index
                    ),
                )
                with me.box(
                    style=me.Style(
                        display="flex",
                        justify_content="space-between",
                        padding=me.Padding(bottom=16),
                    )
                ):
                    me.button(
                        "Cancel",
                        on_click=partial(
                            click_cancel_edit_message, turn_index=turn_index
                        ),
                    )
                    me.button(
                        "Update",
                        type="flat",
                        on_click=partial(
                            click_update_edit_message, turn_index=turn_index
                        ),
                    )
            else:
                markdown(message.content.get_text())
        with me.box(
            style=me.Style(display="flex", gap=4), classes="user-select-none"
        ):
            with me.tooltip(message="Copy to clipboard"):
                with me.content_button(
                    type="icon",
                    on_click=partial(
                        on_click_copy_content,
                        content=message.content.get_text(),
                    ),
                ):
                    me.icon("content_copy")
            with me.tooltip(message="Edit message"):
                with me.content_button(
                    type="icon",
                    # on_click=click_edit_message,
                    on_click=partial(click_edit_message, turn_index=turn_index),
                ):
                    me.icon("edit")


def on_blur_edit_message(e: me.InputBlurEvent, turn_index: int):
    state = me.state(State)
    current_turn = state.current_chat.turns[turn_index]
    user_message = current_turn.current_message
    user_message.content.set_text(e.value)


def click_cancel_edit_message(e: me.ClickEvent, turn_index: int):
    state = me.state(State)
    current_turn = state.current_chat.turns[turn_index]
    user_message = current_turn.current_message
    user_message._is_editing = False


def click_edit_message(e: me.ClickEvent, turn_index: int):
    state = me.state(State)
    current_turn = state.current_chat.turns[turn_index]
    user_message = current_turn.current_message
    user_message._is_editing = True


def on_click_copy_content(e: me.ClickEvent, content: str):
    write_to_clipboard(content)


def on_apply_code(e: mel.WebEvent, turn_index: int):
    logger().info("user action: apply code")

    file_path = e.value["filePath"]
    code_edit = e.value["codeEdit"]
    state = me.state(State)
    state.apply_code_state.origin.chat_id = state.current_chat.id
    state.apply_code_state.origin.turn_index = turn_index
    state.apply_code_state.origin.message_index = state.current_chat.turns[
        turn_index
    ].current_message_index

    edit_context = (
        state.current_chat.turns[turn_index]
        .messages[state.apply_code_state.origin.message_index]
        .content.get_direct_text()
    )
    yield from orchestrate_apply_code(
        [
            FileEdit(
                file_path=file_path,
                code_edit=code_edit,
            )
        ],
        edit_context=edit_context,
    )


# This is a hacky way to ensure that third-party developers don't
# have to worry about passing in the current turn_index


@me.stateclass
class MarkdownState:
    turn_index = 0


@set_markdown_proxy
def wrapped_markdown(**kwargs):
    markdown(
        **kwargs,
        on_apply_code=partial(
            on_apply_code, turn_index=me.state(MarkdownState).turn_index
        ),
    )


def assistant_message(
    *, turn_index: int, message: ChatMessage, is_last_turn: bool
):
    me.state(MarkdownState).turn_index = turn_index
    state = me.state(State)
    with me.box(
        key="assistant-message-" + str(turn_index),
        style=me.Style(display="flex", flex_direction="column", min_width=0),
    ):
        with me.accordion():
            render_chat_content(
                message.content,
                turn_index,
                is_last_turn,
                is_root=True,
                is_last_content=len(message.content.children) == 0,
                pad_ids=state.current_chat.pad_ids,
                key="turn=" + str(turn_index),
            )


def click_open_pad(e: me.ClickEvent, pad_str: str):
    state = me.state(State)
    pad = Pad.model_validate_json(pad_str)
    assert pad.id is not None
    maybe_pad = get_pad(pad.id)
    if maybe_pad:
        pad = maybe_pad

    state.pad = pad
    set_side_pane("pad")


@me.stateclass
class OpenAcademyEmbedState:
    current_chat_id: str | None = None
    is_expanded: bool = False
    turn_index: int = -1


def is_academy_embed_expanded(turn_index: int):
    embed_state = me.state(OpenAcademyEmbedState)
    return (
        embed_state.is_expanded
        and embed_state.current_chat_id == me.state(State).current_chat.id
        and embed_state.turn_index == turn_index
    )


def click_open_academy_embed(e: me.ClickEvent, *, turn_index: int):
    state = me.state(OpenAcademyEmbedState)
    state.is_expanded = True
    state.current_chat_id = me.state(State).current_chat.id
    state.turn_index = turn_index


def pad_block(
    pad: Pad,
    academy_collection_id: str | None,
    turn_index: int,
    has_error: bool,
):
    is_academy_expanded = is_academy_embed_expanded(turn_index)
    with me.box(
        style=me.Style(
            display="flex",
            gap=12,
            flex_wrap="wrap",
            margin=me.Margin(bottom=12),
        )
    ):
        if academy_collection_id:
            academy_collection = me.state(State).academy_data.get_collection(
                academy_collection_id
            )
            if academy_collection:
                with me.box(
                    style=me.Style(
                        flex_grow=1,
                        flex_shrink=0,
                        background=me.theme_var("surface-container-low"),
                        padding=me.Padding.symmetric(vertical=8, horizontal=12),
                        border_radius=12,
                        display="flex",
                        align_items="center",
                        justify_content="space-between",
                        gap=8,
                        cursor="pointer" if not is_academy_expanded else None,
                    ),
                    on_click=partial(
                        click_open_academy_embed,
                        turn_index=turn_index,
                    )
                    if not is_academy_expanded
                    else None,
                    classes="hover-surface-container-high"
                    if not is_academy_expanded
                    else "(hack to clear)",
                ):
                    with me.box(
                        style=me.Style(
                            display="flex", gap=12, align_items="center"
                        )
                    ):
                        me.icon("movie")
                        with me.box(
                            style=me.Style(
                                display="flex", flex_direction="column"
                            )
                        ):
                            me.text(
                                "Preview Dyad Academy videos",
                                style=me.Style(
                                    font_size=13,
                                    color=me.theme_var("on-surface-variant"),
                                    font_weight=500,
                                ),
                            )
                            me.text(academy_collection.title)
                    if not is_academy_expanded:
                        with me.box(
                            style=me.Style(display="flex", align_items="center")
                        ):
                            me.icon(
                                "open_in_full",
                                style=me.Style(margin=me.Margin(left=4)),
                            )

        with me.box(
            style=me.Style(
                background=me.theme_var("surface-container-low"),
                padding=me.Padding.symmetric(vertical=8, horizontal=12),
                border_radius=12,
                display="flex",
                align_items="center",
                justify_content="space-between",
                gap=8,
                flex_grow=1,
                flex_shrink=0,
                cursor="pointer",
            ),
            on_click=partial(click_open_pad, pad_str=pad.model_dump_json()),
            classes="hover-surface-container-high testing-open-pad",
        ):
            with me.box(
                style=me.Style(display="flex", gap=12, align_items="center")
            ):
                me.icon("description")
                with me.box(
                    style=me.Style(display="flex", flex_direction="column")
                ):
                    me.text(
                        "Open pad",
                        style=me.Style(
                            font_size=13,
                            color=me.theme_var("on-surface-variant"),
                            font_weight=500,
                        ),
                    )
                    me.text(pad.title)
            with me.box(style=me.Style(display="flex", align_items="center")):
                if not pad.complete and not has_error:
                    me.progress_spinner(diameter=24, stroke_width=3)

                me.icon(
                    "chevron_right", style=me.Style(margin=me.Margin(left=4))
                )
    if is_academy_expanded and academy_collection_id:
        academy_embed(academy_collection_id)


def render_block(
    content: Content,
    segments: list[ParsedSegment],
    pad_ids: list[str],
    turn_index: int,
    academy_collection_id: str | None,
):
    render = None
    if content.internal_tool_render_id:
        render = get_render(content.internal_tool_render_id)
    if render:
        try:
            render(content)
        except Exception as e:
            me.text(
                "Error rendering data, dumping JSON output",
                style=me.Style(color=me.theme_var("error")),
            )
            me.code(str(content.internal_data), language="js")
            me.text("Error")
            me.code(str(e))
    else:
        pad_ids_remaining = list(reversed(pad_ids))
        for segment in segments:
            if isinstance(segment, TextContent):
                markdown(
                    segment.text,
                    on_apply_code=partial(on_apply_code, turn_index=turn_index),
                )
            elif isinstance(segment, Pad):
                if not pad_ids_remaining:
                    me.text("Error: could not render pad correctly")
                    me.code(str(segment))
                else:
                    segment.id = pad_ids_remaining.pop()
                    pad_block(
                        segment,
                        academy_collection_id,
                        turn_index=turn_index,
                        has_error=bool(content.errors),
                    )
            elif isinstance(segment, FollowUpPrompts):
                follow_up_prompts_box(segment.prompts)
            elif isinstance(segment, AcademyCollection):
                continue
            else:
                me.text("Error: could not render segment correctly")
                me.code(str(segment))

    for error in content.errors:
        error_box(error)

    if any(error.source == "system" for error in content.errors):
        with me.box(
            style=me.Style(
                display="flex",
                gap=2,
                margin=me.Margin(top=8, left=4),
                color=me.theme_var(
                    "error",
                ),
            )
        ):
            me.link(
                text="Report error",
                url="https://github.com/dyad-sh/dyad/issues",
                open_in_new_tab=True,
                style=me.Style(
                    text_decoration="none",
                    color=me.theme_var("error"),
                ),
            )
            me.icon(
                "open_in_new",
                style=me.Style(font_size=18, margin=me.Margin(top=4)),
            )

    for call_metadata in content.metadata.calls:
        if call_metadata.seconds_taken > 0:
            with me.box(
                style=me.Style(
                    display="flex",
                    gap=16,
                    font_size=14,
                    border=me.Border.all(
                        me.BorderSide(
                            width="0.5px",
                            color=me.theme_var("outline-variant"),
                            style="solid",
                        )
                    ),
                    padding=me.Padding.symmetric(vertical=8, horizontal=12),
                    border_radius=12,
                    margin=me.Margin(bottom=12),
                ),
                key="chat-response-metadata",
            ):
                if call_metadata.language_model_id:
                    language_model = get_language_model(
                        call_metadata.language_model_id
                    )
                    me.text(f"Model: {language_model.name}")
                with me.tooltip(
                    message=f"Cached: {call_metadata.cached_input_tokens_count}\nUncached: {call_metadata.input_tokens_count}"
                ):
                    me.text(
                        f"Input: {call_metadata.input_tokens_count + call_metadata.cached_input_tokens_count} tokens"
                    )
                me.text(f"Output: {call_metadata.output_tokens_count} tokens")
                me.text(f"Time: {call_metadata.seconds_taken:.2f}s")


def error_box(error: ContentError):
    with me.box(
        style=me.Style(
            background=me.theme_var("error-container")
            if error.source == "system"
            else me.theme_var("surface-container-high"),
            padding=me.Padding.symmetric(horizontal=16, vertical=4),
            border_radius=16,
            margin=me.Margin.symmetric(vertical=8),
            display="flex",
            align_items="center",
        )
    ):
        me.icon("error", style=me.Style(margin=me.Margin(right=8, top=4)))
        me.markdown(
            error.message,
            style=me.Style(
                color=me.theme_var("on-error-container")
                if error.source == "system"
                else None,
                margin=me.Margin.symmetric(vertical=-12),
            ),
        )


def error_message_box(error_message: str):
    with me.box(
        style=me.Style(
            background=me.theme_var("error-container"),
            padding=me.Padding.symmetric(horizontal=16, vertical=4),
            border_radius=16,
            margin=me.Margin.symmetric(vertical=8),
        )
    ):
        me.markdown(
            error_message,
            style=me.Style(
                color=me.theme_var("on-error-container"),
                margin=me.Margin.symmetric(vertical=-12),
            ),
        )


@me.stateclass
class ExpandState:
    is_expanded: dict[str, bool] = field(default_factory=dict)
    initial_expand: set[str] = field(default_factory=set)


def toggle_expand(e: me.ClickEvent, key: str):
    me.state(ExpandState).is_expanded[key] = not me.state(
        ExpandState
    ).is_expanded.get(key, False)


@me.content_component
def expansion_panel(*, icon: str, title: str, key: str, expanded: bool = False):
    state = me.state(ExpandState)
    if expanded is True and key not in state.initial_expand:
        state.initial_expand.add(key)
        state.is_expanded[key] = True
    if expanded is False and key in state.initial_expand:
        state.is_expanded[key] = False
        state.initial_expand.discard(key)
    expanded = state.is_expanded.get(key, False)
    with me.box(
        style=me.Style(
            border_radius=8,
            margin=me.Margin.symmetric(vertical=12) if expanded else None,
            border=me.Border.all(
                me.BorderSide(
                    width="0.5px",
                    style="solid",
                    color=me.theme_var("outline-variant"),
                )
            )
            if not expanded
            else None,
            transition="all 0.15s ease-in",
            box_shadow="0px 2px 1px -1px rgba(255, 255, 255, .1), 0px 1px 1px 0px rgba(255, 255, 255, .14), 0px 1px 3px 0px rgba(255, 255, 255, .12)"
            if me.theme_brightness() == "dark"
            else "0px 2px 1px -1px rgba(0, 0, 0, .1), 0px 1px 1px 0px rgba(0, 0, 0, .07), 0px 1px 3px 0px rgba(0, 0, 0, .06)"
            if expanded
            else None,
        )
    ):
        with me.box(
            style=me.Style(
                display="flex",
                align_items="center",
                border_radius="8px 8px 0 0 " if expanded else 8,
                padding=me.Padding.symmetric(vertical=4, horizontal=16),
                background=me.theme_var("surface-container-low"),
                justify_content="space-between",
                cursor="pointer",
            ),
            on_click=functools.partial(toggle_expand, key=key),
        ):
            with me.box(
                style=me.Style(display="flex"),
            ):
                me.icon(icon, style=me.Style(margin=me.Margin(right=8)))
                me.text(
                    title,
                    style=me.Style(
                        font_size=16, font_weight=500, margin=me.Margin(top=2)
                    ),
                )
            with me.content_button(type="icon"):
                me.icon(
                    "keyboard_arrow_up" if expanded else "keyboard_arrow_down"
                )
        with me.box(
            style=me.Style(
                display="none" if not expanded else "block",
                transition="all 0.3s ease-in",
                padding=me.Padding.all(16),
            )
        ):
            me.slot()


def render_chat_content(
    content: Content,
    turn_index: int,
    is_last_turn: bool,
    pad_ids: list[str],
    key: str,
    is_root: bool = False,
    is_last_content: bool = False,
):
    state = me.state(State)
    turn = state.current_chat.turns[turn_index]
    messages = turn.messages

    structured_output = parse_content_with_pad(content.get_direct_text())
    academy_collection_id = structured_output.get_academy_collection_id()
    segments = structured_output.segments
    if content.internal_checkpoint:
        checkpoint_box(content.internal_checkpoint, key=key)
        return
    if content.step.type == "tool_call":
        tool = get_tool_from_id(content.step.tool_id)
        if tool is None:
            error_message_box(f"Tool {content.step.tool_id} not found")
            render_block(
                content=content,
                segments=segments,
                pad_ids=pad_ids,
                turn_index=turn_index,
                academy_collection_id=academy_collection_id,
            )
        else:
            with expansion_panel(
                icon=tool.icon or "lightbulb",
                title=tool.description,
                expanded=is_last_content,
                key=key,
            ):
                if content.step:
                    tool_call_box(content.step, key=key + "-tool-call-box")
                if content.is_loading and is_last_content:
                    loading_block()

                render_block(
                    content=content,
                    segments=segments,
                    pad_ids=pad_ids,
                    turn_index=turn_index,
                    academy_collection_id=academy_collection_id,
                )
    elif content.step.type == "error":
        with me.box(
            style=me.Style(
                background=me.theme_var("error-container"),
                padding=me.Padding.symmetric(horizontal=16, vertical=4),
                border_radius=16,
            )
        ):
            me.markdown(
                content.step.error_message,
                style=me.Style(color=me.theme_var("on-error-container")),
            )
    elif content.step.type == "default":
        me.box(style=me.Style(height=16))
        if content.is_loading:
            loading_block()
        render_block(
            content=content,
            segments=segments,
            pad_ids=pad_ids,
            turn_index=turn_index,
            academy_collection_id=academy_collection_id,
        )
    for index, child in enumerate(content.children):
        render_chat_content(
            child,
            turn_index,
            is_last_turn,
            is_root=False,
            is_last_content=len(child.children) == 0
            and child == content.children[-1],
            pad_ids=pad_ids,
            key=key + " " + str(index),
        )

    if not state.in_progress and is_root:
        with me.box(
            style=me.Style(display="flex", gap=8, align_items="center")
        ):
            if len(messages) > 1:
                if turn.current_message_index > 0:
                    icon_button(
                        key=f"previous_message-{turn_index}",
                        icon="arrow_back",
                        tooltip="Previous message",
                        on_click=on_click_previous_message,
                    )
                me.text(f"{turn.current_message_index + 1} / {len(messages)}")
                if turn.current_message_index < len(messages) - 1:
                    icon_button(
                        key=f"next_message-{turn_index}",
                        icon="arrow_forward",
                        tooltip="Next message",
                        on_click=on_click_next_message,
                    )

            if is_last_turn:
                icon_button(
                    key=f"restart-{turn_index}",
                    icon="restart_alt",
                    tooltip="Regenerate answer",
                    on_click=on_click_regenerate,  # type: ignore
                )
            with me.tooltip(message="Copy to clipboard"):
                with me.content_button(
                    type="icon",
                    on_click=partial(
                        on_click_copy_content,
                        content=content.get_text(),
                    ),
                ):
                    me.icon("content_copy")
    if (
        content.metadata.calls
        and is_last_turn
        and is_last_content
        and not state.enable_auto_scroll
    ):
        next_actions(
            show_code_actions=does_content_have_files(content),
            turn_index=turn_index,
            language_model_id=content.metadata.calls[0].language_model_id
            if content.metadata
            else None,
        )


def format_relative_time(timestamp: datetime):
    """Convert timestamp to a human-friendly relative time string (e.g. '2 minutes ago')"""
    now = datetime.now()
    diff = now - timestamp

    seconds = diff.total_seconds()
    if seconds < 60:
        return "just now"
    elif seconds < 3600:
        minutes = int(seconds / 60)
        return f"{minutes} {'minute' if minutes == 1 else 'minutes'} ago"
    elif seconds < 86400:
        hours = int(seconds / 3600)
        return f"{hours} {'hour' if hours == 1 else 'hours'} ago"
    elif seconds < 604800:
        days = int(seconds / 86400)
        return f"{days} {'day' if days == 1 else 'days'} ago"
    else:
        return timestamp.strftime("%Y-%m-%d %H:%M:%S")


def click_revert_checkpoint(e: me.ClickEvent, checkpoint_str: str):
    checkpoint = Checkpoint.model_validate_json(checkpoint_str)
    propose_revert_to_checkpoint(checkpoint)


def checkpoint_box(checkpoint: Checkpoint, key: str):
    with expansion_panel(
        icon="undo",
        title="Checkpoint",
        expanded=True,
        key=key,
    ):
        with me.box(
            style=me.Style(display="flex", flex_direction="column", gap=8)
        ):
            with me.box(
                style=me.Style(
                    display="flex",
                    gap=8,
                    justify_content="space-between",
                    align_items="center",
                )
            ):
                if checkpoint.files:
                    me.text(
                        "Checkpointed "
                        + format_relative_time(checkpoint.files[0].timestamp),
                        style=me.Style(font_weight=500, font_size=14),
                    )
                    with me.content_button(
                        on_click=partial(
                            click_revert_checkpoint,
                            checkpoint_str=checkpoint.model_dump_json(),
                        ),
                        key="revert-to-checkpoint-inline-message",
                    ):
                        with me.box(
                            style=me.Style(
                                display="flex", gap=4, align_items="center"
                            )
                        ):
                            me.icon("undo")
                            me.text("Revert to checkpoint")
            for file in checkpoint.files:
                path_parts = file.original_path.split("/")
                filename = path_parts[-1]
                directory = (
                    "/".join(path_parts[:-1]) if len(path_parts) > 1 else ""
                )

                with me.tooltip(message=file.original_path):
                    with me.box(
                        style=me.Style(
                            display="inline-flex",
                            flex_direction="row",
                            align_items="center",
                            background=me.theme_var("surface-container-low"),
                            padding=me.Padding.all(4),
                            border_radius=8,
                            gap=4,
                            # cursor="pointer",
                            overflow="hidden",
                        ),
                    ):
                        with me.box(style=me.Style(flex_shrink=0)):
                            me.icon(
                                "description",
                            )
                        with me.box(
                            style=me.Style(
                                display="flex",
                                align_items="start",
                                flex_direction="column",
                            )
                        ):
                            me.text(
                                filename,
                                style=me.Style(
                                    font_weight=500,
                                    font_size=14,
                                    white_space="nowrap",
                                    overflow="hidden",
                                    text_overflow="ellipsis",
                                    width=190,
                                ),
                            )
                            if directory:
                                me.text(
                                    directory,
                                    style=me.Style(
                                        font_size=12,
                                        color=me.theme_var(
                                            "on-surface-variant"
                                        ),
                                        white_space="nowrap",
                                        overflow="hidden",
                                        text_overflow="ellipsis",
                                        width=190,
                                    ),
                                )


@me.stateclass
class ToolCallBoxState:
    is_expanded: dict[str, bool]


def toggle_tool_call_box(e: me.ClickEvent):
    state = me.state(ToolCallBoxState)
    state.is_expanded[e.key] = not state.is_expanded.get(e.key, False)


def tool_call_box(step: ToolCallStep, key: str):
    state = me.state(ToolCallBoxState)
    if state.is_expanded.get(key, False) is False:
        with me.box(
            on_click=toggle_tool_call_box,
            key=key,
            style=me.Style(
                padding=me.Padding.symmetric(horizontal=16, vertical=4),
                border_radius=12,
                background=me.theme_var("surface-container-low"),
                cursor="pointer",
                margin=me.Margin(bottom=12),
                display="flex",
                align_items="center",
                gap=4,
            ),
            classes="hover-surface-container-high",
        ):
            me.icon("unfold_more", style=me.Style(margin=me.Margin(top=4)))
            me.text(
                "Show debugging details",
                style=me.Style(
                    font_weight=500,
                    font_size=14,
                ),
            )
            return

    with me.box(
        style=me.Style(
            border_radius=12,
            background=me.theme_var("surface-container-low"),
            display="flex",
            flex_direction="column",
            padding=me.Padding.all(12),
            margin=me.Margin(bottom=12),
            font_size=14,
            gap=8,
        )
    ):
        me.text(
            "Debugging details",
            style=me.Style(
                font_weight=500, font_size=13, margin=me.Margin(bottom=4)
            ),
        )

        with me.box(style=me.Style(display="flex", gap=6)):
            label("Tool name:")
            tool_name = step.tool_id.tool_name
            if step.tool_id == INTERNAL_ROUTER_TOOL_ID:
                tool_name = "Router"
            me.text(tool_name)
            me.box(style=me.Style(width=24))
            label("Package name:")
            me.text(step.tool_id.package_name)
        with me.box(style=me.Style(display="flex", gap=6)):
            label("Args:")
            with me.box(
                style=me.Style(display="flex", flex_direction="column", gap=4)
            ):
                for key, value in step.args.items():
                    with me.box(style=me.Style(display="flex", gap=6)):
                        label(key)
                        me.text(str(value))
        if step.return_value:
            with me.box(style=me.Style(display="flex", gap=6)):
                label("Return Value:")
                me.text(step.return_value)
        with me.box(style=me.Style(display="flex", gap=6)):
            label("Rationale:")
            me.text(
                step.rationale,
                style=me.Style(
                    overflow="hidden",
                    white_space="break-spaces",
                    text_overflow="ellipsis",
                ),
            )


def label(text: str):
    label_style = me.Style(font_weight=500)
    with me.box(style=me.Style(min_width=80)):
        me.text(text, style=label_style)


def next_actions(
    *,
    show_code_actions: bool,
    turn_index: int,
    language_model_id: str | None,
):
    with me.box(
        style=me.Style(
            display="flex",
            flex_direction="column",
            padding=me.Padding.symmetric(horizontal=12),
        )
    ):
        with me.box(style=me.Style(display="flex", flex_wrap="wrap", gap=8)):
            if show_code_actions:
                with action_group_box(title="Code"):
                    with me.box(
                        style=me.Style(
                            display="flex",
                            gap=8,
                        )
                    ):
                        _action_box(
                            icon="edit",
                            title="Apply",
                            description="Apply changes",
                            on_click=click_apply_all,
                        )
                        # TODO: implement these actions
                        # _action_box(
                        #     icon="rate_review",
                        #     title="Review",
                        #     description="Review and verify the proposed code changes",
                        # )
                        # _action_box(
                        #     icon="edit",
                        #     title="Commit",
                        #     description="Commit",
                        # )

                with action_group_box(title="Retry"):
                    with me.box(
                        style=me.Style(
                            display="flex",
                            gap=8,
                        )
                    ):
                        _action_box(
                            icon="add",
                            title="#codebase",
                            description="Retry with codebase context",
                            on_click=partial(
                                click_add_code_context, turn_index=turn_index
                            ),
                        )
                        if language_model_id:
                            next_model = get_next_provider_model(
                                model_id=language_model_id
                            )
                            if next_model:
                                _action_box(
                                    icon="emoji_objects",
                                    title=next_model.display_name,
                                    description=f"Retry with {next_model.display_name}",
                                    on_click=partial(
                                        click_retry_with_model,
                                        model_id=next_model.id,
                                        turn_index=turn_index,
                                    ),
                                )


def academy_embed(academy_collection_id: str):
    me.text(
        "Academy videos",
        style=me.Style(
            font_size=14, font_weight=500, margin=me.Margin(bottom=8)
        ),
    )
    me.embed(
        src=f"{ACADEMY_BASE_URL}/embed?collection-id="
        + academy_collection_id
        + "&theme="
        + get_user_settings().theme_mode,
        style=me.Style(
            border=me.Border.all(me.BorderSide(width=0)),
            width="100%",
            height=190,
        ),
    )


def click_add_code_context(e: me.ClickEvent, *, turn_index: int):
    yield from regenerate_response(turn_index, user_message_suffix=" #codebase")


def click_retry_with_model(e: me.ClickEvent, *, turn_index: int, model_id: str):
    yield from regenerate_response(turn_index, model_id=model_id)


def click_apply_all(e: me.ClickEvent):
    yield from apply_all_code_changes()


def follow_up_prompts_box(prompts: list[str]):
    if not prompts:
        return

    with me.box(style=me.Style(margin=me.Margin(bottom=12))):
        with me.box(
            style=me.Style(
                display="flex", gap=4, flex_direction="column", width="100%"
            )
        ):
            for prompt in prompts:
                prompt_suggestion_box(prompt=prompt)


def prompt_suggestion_box(
    *,
    prompt: str,
):
    icon = "prompt_suggestion"
    """Helper function to create consistent action boxes"""
    with me.box(
        classes="hover-surface-container-highest",
        style=me.Style(
            cursor="pointer",
            background=me.theme_var("surface-container-low"),
            border_radius=12,
            padding=me.Padding.symmetric(vertical=4, horizontal=12),
            display="flex",
            flex_direction="column",
            gap=8,
        ),
        on_click=partial(on_click_prompt_suggestion, input=prompt),
    ):
        with me.box(
            style=me.Style(
                display="flex",
                align_items="center",
                gap=16,
            )
        ):
            me.icon(
                icon,
                style=me.Style(
                    # color=me.theme_var("secondary"),
                    font_size=24,
                ),
            )

            me.text(
                prompt,
                style=me.Style(
                    font_size=16,
                    # font_weight=500,
                    # color=me.theme_var("secondary"),
                ),
            )


def on_click_prompt_suggestion(e: me.ClickEvent, input: str):
    yield from submit_follow_up_prompt(input)


@me.content_component
def action_group_box(*, title: str):
    with me.box(
        style=me.Style(
            background=me.theme_var("surface"),
            padding=me.Padding(left=12, top=8, bottom=8, right=12),
            box_shadow="rgba(0, 0, 0, 0.2) 0px 3px 1px -2px",
            border_radius=12,
            display="flex",
            align_items="center",
            # gap=8,
            margin=me.Margin(
                right=8,
            ),
        )
    ):
        with me.box(
            style=me.Style(
                # width=60,
                white_space="nowrap",
                text_overflow="ellipsis",
                overflow="hidden",
                margin=me.Margin(right=12),
            )
        ):
            me.text(
                title,
                style=me.Style(
                    font_size=14,
                    font_weight=500,
                ),
            )
        me.slot()


def _action_box(
    *,
    icon: str,
    title: str,
    description: str,
    on_click: Callable[[me.ClickEvent], Any],
    is_large=False,
    background=None,
):
    if background is None:
        background = me.theme_var("surface-container")
    """Helper function to create consistent action boxes"""
    with me.box(
        classes="hover-surface-container-highest",
        style=me.Style(
            cursor="pointer",
            background=background,
            border_radius=12,
            padding=me.Padding.symmetric(horizontal=12, vertical=4),
            display="flex",
            flex_direction="column",
            gap=8,
        ),
        on_click=on_click,
    ):
        with me.box(
            style=me.Style(
                display="flex",
                align_items="center",
                gap=8,
            )
        ):
            me.icon(
                icon,
                style=me.Style(
                    color=me.theme_var("secondary"),
                    font_size=24,
                ),
            )
            with me.tooltip(message=description):
                me.text(
                    title,
                    style=me.Style(
                        font_size=16 if is_large else 14,
                        font_weight=500,
                        color=me.theme_var("secondary"),
                        white_space="nowrap",
                        text_overflow="ellipsis",
                        overflow="hidden",
                    ),
                )


def on_click_previous_message(e: me.ClickEvent):
    state = me.state(State)
    _, turn_index = e.key.split("-")
    turn_index = int(turn_index)
    turn = state.current_chat.turns[turn_index]
    turn.current_message_index -= 1


def on_click_next_message(e: me.ClickEvent):
    state = me.state(State)
    _, turn_index = e.key.split("-")
    turn_index = int(turn_index)
    turn = state.current_chat.turns[turn_index]
    turn.current_message_index += 1


def floating_scroll_to_bottom_button():
    key = "scroll-to-bottom-button"
    with me.box(
        style=me.Style(
            position="absolute",
            left="50%",
            bottom=20,
        )
    ):
        with me.tooltip(
            message="Scroll to bottom", show_delay_ms=300, key=key + "-tooltip"
        ):
            with me.content_button(
                type="icon",
                key=key,
                style=me.Style(
                    background=me.theme_var("surface-container-highest"),
                    z_index=2,
                ),
                on_click=on_click_scroll_to_bottom,
            ):
                me.icon("keyboard_arrow_down")


def on_click_scroll_to_bottom(e: me.ClickEvent):
    me.state(State).scroll_counter += 1


def on_click_regenerate(e: me.ClickEvent):
    """Regenerates response from an existing message"""

    _, turn_index = e.key.split("-")
    turn_index = int(turn_index)
    yield from regenerate_response(turn_index)
