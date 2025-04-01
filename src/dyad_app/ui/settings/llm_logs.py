import functools
from datetime import datetime
from typing import Literal

import mesop as me
from dyad.logging.llm_calls import (
    LanguageModelCallRecord,
    LanguageModelRequestRecord,
    llm_call_logger,
)


@me.stateclass
class LLMLogState:
    selected_call_id: int | None = None
    selected_detail_type: Literal["request", "response"] | None = None
    expanded_sections: dict[str, bool]


def llm_logs_settings():
    state = me.state(LLMLogState)
    llm_calls = llm_call_logger().get_recent_calls()

    is_detail_selected = state.selected_call_id is not None

    # Main layout: Two columns (Log list and Detail panel)
    # Use a key to help Mesop manage state changes smoothly across layout shifts
    with me.box(
        key="llm_logs_main_layout",
        style=me.Style(
            display="flex",
            gap=0,
            height="calc(100vh - 160px)",
        ),
    ):
        # Left column: Log list
        left_panel_width = "100%" if not is_detail_selected else "25%"
        with me.box(
            style=me.Style(
                width=left_panel_width,
                flex_shrink=0,
                padding=me.Padding.all(16)
                if not is_detail_selected
                else me.Padding(right=12, top=16, bottom=16, left=16),
                transition="width 0.3s ease-in-out, padding 0.3s ease-in-out",
                height="100%",
                overflow_y="auto",
            )
        ):
            with me.box(
                style=me.Style(
                    display="flex",
                    justify_content="end",
                    margin=me.Margin(bottom=16),
                )
            ):
                me.button(
                    "Clear LLM Logs",
                    on_click=clear_llm_logs_handler,
                    type="flat",
                    style=me.Style(
                        color=me.theme_var("error"),
                        background=me.theme_var("error-container"),
                    ),
                )

            if not llm_calls:
                me.text(
                    "No LLM calls recorded yet.",
                    style=me.Style(font_style="italic"),
                )
            else:
                for call in llm_calls:
                    render_llm_call_summary(call)

        # Right column: Detail Panel (conditionally rendered and animated)
        right_panel_width = "75%" if is_detail_selected else "0%"
        right_panel_opacity = 1.0 if is_detail_selected else 0.0
        right_panel_padding = (
            me.Padding.all(16) if is_detail_selected else me.Padding.all(0)
        )

        with me.box(
            style=me.Style(
                width=right_panel_width,
                opacity=right_panel_opacity,
                overflow="hidden",  # Keep outer overflow hidden for animation
                flex_shrink=0,
                transition="width 0.3s ease-in-out, opacity 0.3s ease-in-out, padding 0.3s ease-in-out",
                padding=right_panel_padding,
                height="100%",
            )
        ):
            if is_detail_selected:
                render_detail_panel(state, llm_calls)
            else:
                # Render an empty box to maintain layout structure during transition
                me.box(style=me.Style(height="100%"))


def render_llm_call_summary(call: LanguageModelCallRecord):
    request = call.request
    response = call.response

    time_ago = (datetime.utcnow() - call.timestamp).total_seconds()
    if time_ago < 60:
        time_display = f"{time_ago:.0f} secs ago"
    elif time_ago < 3600:
        time_display = f"{time_ago / 60:.0f} mins ago"
    else:
        time_display = f"{time_ago / 3600:.1f} hours ago"

    with me.box(
        key=f"call_summary_{call.id}",
        style=me.Style(
            border=me.Border.all(
                me.BorderSide(
                    width=0,
                    color=me.theme_var("outline-variant"),
                    style="solid",
                )
            ),
            border_radius=8,
            padding=me.Padding.symmetric(vertical=8),
        ),
    ):
        with me.box(
            style=me.Style(
                display="flex",
                justify_content="space-between",
                margin=me.Margin(bottom=8),
            )
        ):
            me.text(
                f"Call #{call.id}",
                style=me.Style(font_weight=500, font_size=14),
            )
            me.text(
                time_display,
                style=me.Style(
                    color=me.theme_var("on-surface-variant"), font_size=12
                ),
            )

        with me.box(
            style=me.Style(
                background=me.theme_var("surface-container-low"),
                padding=me.Padding(left=6, right=6, top=16, bottom=8),
                border_radius=8,
                margin=me.Margin(bottom=8),
                cursor="pointer",
            ),
            classes="hover-surface-container-high",
            on_click=functools.partial(
                select_detail, call_id=call.id, detail_type="request"
            ),
        ):
            with me.box(
                style=me.Style(
                    display="flex",
                    justify_content="space-between",
                    align_items="center",
                )
            ):
                with me.box(
                    style=me.Style(
                        display="flex",
                        gap=4,
                        align_items="center",
                        font_size=14,
                        position="relative",
                    )
                ):
                    me.text(
                        "Request",
                        style=me.Style(
                            font_weight=500,
                            color=me.theme_var("outline"),
                            font_size=12,
                            position="absolute",
                            top=-16,
                            left=6,
                        ),
                    )
                    if not me.state(LLMLogState).selected_call_id:
                        me.box()
                        message_count = len(request.history)
                        model = request.language_model_id
                        me.text(
                            "Model:",
                            style=me.Style(font_weight=500),
                        )
                        me.text(
                            model,
                            style=me.Style(
                                white_space="nowrap",
                                text_overflow="ellipsis",
                                overflow="hidden",
                            ),
                        )
                        me.box()
                        me.text("Messages:", style=me.Style(font_weight=500))
                        me.text(str(message_count))
                me.icon(
                    "chevron_right",
                )

        with me.box(
            style=me.Style(
                background=me.theme_var("surface-container-low"),
                padding=me.Padding(left=6, right=6, top=16, bottom=8),
                border_radius=8,
                margin=me.Margin(bottom=8),
                cursor="pointer",
            ),
            classes="hover-surface-container-high",
            on_click=functools.partial(
                select_detail, call_id=call.id, detail_type="response"
            ),
        ):
            with me.box(
                style=me.Style(
                    display="flex",
                    justify_content="space-between",
                    align_items="center",
                )
            ):
                with me.box(
                    style=me.Style(
                        display="flex",
                        gap=4,
                        align_items="center",
                        font_size=14,
                        position="relative",
                    )
                ):
                    me.text(
                        "Response",
                        style=me.Style(
                            font_weight=500,
                            color=me.theme_var("outline"),
                            font_size=12,
                            position="absolute",
                            top=-16,
                            left=6,
                        ),
                    )
                    me.box()
                    completion_metadata = response.get_completion_metadata()
                    if not me.state(LLMLogState).selected_call_id:
                        if not completion_metadata:
                            me.text("No metadata available.")
                        else:
                            me.text(
                                "Input tokens:", style=me.Style(font_weight=500)
                            )
                            me.text(str(completion_metadata.input_tokens_count))
                            if completion_metadata.cached_input_tokens_count:
                                me.box()
                                me.text(
                                    "Input tokens (cached):",
                                    style=me.Style(font_weight=500),
                                )
                                me.text(
                                    str(
                                        completion_metadata.cached_input_tokens_count
                                    )
                                )
                            me.box()
                            me.text(
                                "Output tokens:",
                                style=me.Style(font_weight=500),
                            )
                            me.text(
                                str(completion_metadata.output_tokens_count)
                            )

                me.icon(
                    "chevron_right",
                )


def render_detail_panel(
    state: LLMLogState, llm_calls: list[LanguageModelCallRecord]
):
    selected_call = next(
        (call for call in llm_calls if call.id == state.selected_call_id), None
    )

    if not selected_call:
        me.text("Error: Selected call not found.", style=me.Style(color="red"))
        return
    if not state.selected_detail_type:
        me.text("Error: No detail type selected.", style=me.Style(color="red"))
        return
    with me.box(
        style=me.Style(
            border_radius=8,
            height="100%",
            display="flex",
            flex_direction="column",
            background=me.theme_var("surface"),
        )
    ):
        with me.box(
            style=me.Style(
                display="flex",
                justify_content="space-between",
                align_items="center",
                margin=me.Margin(bottom=12),
                padding=me.Padding.all(16),
                border=me.Border(
                    bottom=me.BorderSide(
                        width=1, color=me.theme_var("outline-variant")
                    )
                ),
                flex_shrink=0,
            )
        ):
            panel_title = (
                f"{state.selected_detail_type.capitalize()} Details "
                f"(Call #{state.selected_call_id})"
            )
            with me.content_button(type="icon", on_click=close_detail_panel):
                me.icon("close")
            me.text(panel_title, style=me.Style(font_weight=500, font_size=16))
            me.box()

        with me.box(
            style=me.Style(
                overflow_y="auto",
                flex_grow=1,
                padding=me.Padding.all(16),
            )
        ):
            if state.selected_detail_type == "request":
                request = selected_call.request
                expandable_system_prompt_box(request, state)
                expandable_input_box(request, state)
                expandable_history_box(request, state)

                with me.box(
                    style=me.Style(
                        margin=me.Margin(top=12),
                        padding=me.Padding.all(8),
                        background=me.theme_var("surface-container"),
                        border_radius=4,
                    )
                ):
                    me.text(
                        "Parameters:",
                        style=me.Style(
                            font_weight=500, margin=me.Margin(bottom=4)
                        ),
                    )
                    if request.prediction:
                        me.text(
                            f"Prediction: {request.prediction}",
                            style=me.Style(
                                font_family="monospace", font_size=13
                            ),
                        )
                    if request.output_type_name:
                        me.text(
                            f"Output Type: {request.output_type_name}",
                            style=me.Style(
                                font_family="monospace", font_size=13
                            ),
                        )

            elif state.selected_detail_type == "response":
                response = selected_call.response
                if response.chunks:
                    full_content = ""
                    for chunk in response.chunks:
                        if chunk.type == "text":
                            full_content += chunk.text if chunk.text else ""

                    if full_content:
                        expandable_content_box(
                            "Response Content",
                            full_content,
                            state,
                            f"response_{state.selected_call_id}",
                        )
                    else:
                        me.text("No text content in response chunks.")

                else:
                    me.text("Response contains no chunks.")


def expandable_input_box(
    request: LanguageModelRequestRecord, state: LLMLogState
):
    section_id = f"input_{state.selected_call_id}"
    expandable_content_box("Input", request.input, state, section_id)


def expandable_system_prompt_box(
    request: LanguageModelRequestRecord, state: LLMLogState
):
    if request.system_prompt:
        section_id = f"system_prompt_{state.selected_call_id}"
        expandable_content_box(
            "System Prompt", request.system_prompt, state, section_id
        )


def expandable_history_box(
    request: LanguageModelRequestRecord, state: LLMLogState
):
    if request.history:
        me.text(
            "History:",
            style=me.Style(font_weight=500, margin=me.Margin(bottom=8)),
        )
        for i, msg in enumerate(reversed(request.history)):
            section_id = f"history_{state.selected_call_id}_{i}"
            expandable_content_box(
                f"Role: {msg.role}", msg.text, state, section_id
            )


def expandable_content_box(
    title: str, content: str, state: LLMLogState, section_id: str
):
    is_expanded = state.expanded_sections.get(section_id, False)

    # Determine preview text (first 100 characters or less)
    preview_length = 100
    has_more = len(content) > preview_length
    preview_text = content[:preview_length] + ("..." if has_more else "")

    me.text(
        title,
        style=me.Style(font_weight=500, margin=me.Margin(bottom=4)),
    )

    with me.box(
        style=me.Style(
            padding=me.Padding.all(8),
            background=me.theme_var("surface-container"),
            border_radius=8,
            margin=me.Margin(top=4, bottom=8),
        )
    ):
        # Show either preview or full content based on expanded state
        displayed_text = content if is_expanded else preview_text
        me.text(
            displayed_text,
            style=me.Style(
                white_space="pre-wrap",
                font_family="monospace",
                font_size=13,
            ),
        )

        # Only show expand/collapse button if there's more content
        if has_more:
            with me.box(
                style=me.Style(
                    display="flex",
                    justify_content="center",
                    margin=me.Margin(top=8),
                )
            ):
                icon_name = "expand_less" if is_expanded else "expand_more"
                with me.content_button(
                    on_click=functools.partial(
                        toggle_section_expansion, section_id=section_id
                    ),
                    type="icon",
                    style=me.Style(
                        display="flex",
                        align_items="center",
                        gap=4,
                        color=me.theme_var("primary"),
                    ),
                ):
                    me.icon(icon_name)


def toggle_section_expansion(e: me.ClickEvent, section_id: str):
    state = me.state(LLMLogState)
    current_value = state.expanded_sections.get(section_id, False)
    state.expanded_sections[section_id] = not current_value


def select_detail(
    e: me.ClickEvent, call_id: int, detail_type: Literal["request", "response"]
):
    state = me.state(LLMLogState)
    if (
        state.selected_call_id == call_id
        and state.selected_detail_type == detail_type
    ):
        state.selected_call_id = None
        state.selected_detail_type = None
    else:
        state.selected_call_id = call_id
        state.selected_detail_type = detail_type


def close_detail_panel(e: me.ClickEvent):
    state = me.state(LLMLogState)
    state.selected_call_id = None
    state.selected_detail_type = None


def clear_llm_logs_handler(e: me.ClickEvent):
    state = me.state(LLMLogState)
    llm_call_logger().clear_calls()
    state.selected_call_id = None
    state.selected_detail_type = None
