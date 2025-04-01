import functools
from datetime import datetime

import mesop as me
from dyad.logging.llm_calls import LanguageModelCallRecord, llm_call_logger


@me.stateclass
class LLMLogState:
    expanded_request_ids: list[int]
    expanded_response_ids: list[int]


def llm_logs_settings():
    llm_calls = llm_call_logger().get_recent_calls()

    # Add Clear LLM Logs button
    with me.box(
        style=me.Style(
            display="flex",
            justify_content="end",
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
            "No LLM calls recorded yet.", style=me.Style(font_style="italic")
        )
    else:
        for call in llm_calls:
            render_llm_call(call)


def render_llm_call(call: LanguageModelCallRecord):
    state = me.state(LLMLogState)
    # Use request and response directly
    request = call.request
    response = call.response

    # Calculate time ago
    time_ago = (datetime.utcnow() - call.timestamp).total_seconds()
    if time_ago < 60:
        time_display = f"{time_ago:.0f} secs ago"
    elif time_ago < 3600:
        time_display = f"{time_ago / 60:.0f} mins ago"
    else:
        time_display = f"{time_ago / 3600:.1f} hours ago"

    # Container for the entire call
    with me.box(
        style=me.Style(
            border=me.Border.all(
                me.BorderSide(
                    width=1,
                    color=me.theme_var("outline-variant"),
                    style="solid",
                )
            ),
            border_radius=8,
            margin=me.Margin(bottom=16),
            padding=me.Padding.all(16),
        )
    ):
        # Call metadata
        with me.box(
            style=me.Style(
                display="flex",
                justify_content="space-between",
                margin=me.Margin(bottom=8),
            )
        ):
            me.text(
                f"LLM Call #{call.id}",
                style=me.Style(font_weight=500, font_size=16),
            )
            me.text(
                time_display,
                style=me.Style(color=me.theme_var("on-surface-variant")),
            )

        # Request section
        with me.box(
            style=me.Style(
                background=me.theme_var("surface-container-low"),
                padding=me.Padding.all(12),
                border_radius=4,
                margin=me.Margin(bottom=8),
            )
        ):
            with me.box(
                style=me.Style(
                    display="flex",
                    justify_content="space-between",
                    align_items="center",
                    margin=me.Margin(bottom=8),
                )
            ):
                me.text(
                    "Request",
                    style=me.Style(
                        font_weight=500, color=me.theme_var("primary")
                    ),
                )

                # Toggle button for request
                me.button(
                    "Toggle Details",
                    on_click=functools.partial(toggle_request, call_id=call.id),
                    style=me.Style(padding=me.Padding.all(4), height="auto"),
                )

            # Request content
            if call.id in state.expanded_request_ids:
                # Show full request
                if request.history:
                    for msg in request.history:
                        with me.box(
                            style=me.Style(
                                margin=me.Margin(bottom=8),
                                padding=me.Padding.all(8),
                                background=me.theme_var("surface-container"),
                                border_radius=4,
                            )
                        ):
                            me.text(
                                f"Role: {msg.role}",
                                style=me.Style(
                                    font_weight=500, margin=me.Margin(bottom=4)
                                ),
                            )
                            me.text(
                                msg.content.get_text(),
                                style=me.Style(
                                    white_space="pre-wrap",
                                    font_family="monospace",
                                ),
                            )

                # Show input content if available
                with me.box(
                    style=me.Style(
                        margin=me.Margin(bottom=8),
                        padding=me.Padding.all(8),
                        background=me.theme_var("surface-container"),
                        border_radius=4,
                    )
                ):
                    me.text(
                        "Input:",
                        style=me.Style(
                            font_weight=500, margin=me.Margin(bottom=4)
                        ),
                    )
                    me.text(
                        str(request.input),
                        style=me.Style(
                            white_space="pre-wrap",
                            font_family="monospace",
                        ),
                    )

                # Show other request parameters
                with me.box(
                    style=me.Style(
                        margin=me.Margin(top=8),
                        padding=me.Padding.all(8),
                        background=me.theme_var("surface-container"),
                        border_radius=4,
                    )
                ):
                    me.text(
                        f"Language Model ID: {request.language_model_id}",
                        style=me.Style(font_family="monospace"),
                    )
                    if request.system_prompt:
                        me.text(
                            f"System Prompt: {request.system_prompt}",
                            style=me.Style(font_family="monospace"),
                        )
                    if request.prediction:
                        me.text(
                            f"Prediction: {request.prediction}",
                            style=me.Style(font_family="monospace"),
                        )
                    if request.output_type:
                        me.text(
                            f"Output Type: {request.output_type}",
                            style=me.Style(font_family="monospace"),
                        )
            else:
                # Show summary
                message_count = len(request.history)
                model = request.language_model_id
                me.text(f"Model: {model}, Messages: {message_count}")

        # Response section
        with me.box(
            style=me.Style(
                background=me.theme_var("surface-container-low"),
                padding=me.Padding.all(12),
                border_radius=4,
            )
        ):
            with me.box(
                style=me.Style(
                    display="flex",
                    justify_content="space-between",
                    align_items="center",
                    margin=me.Margin(bottom=8),
                )
            ):
                me.text(
                    "Response",
                    style=me.Style(
                        font_weight=500, color=me.theme_var("tertiary")
                    ),
                )

                # Toggle button for response
                me.button(
                    "Toggle Details",
                    on_click=functools.partial(
                        toggle_response, call_id=call.id
                    ),
                    style=me.Style(padding=me.Padding.all(4), height="auto"),
                )

            # Response content
            if call.id in state.expanded_response_ids:
                # Show full response
                if response.chunks:
                    full_content = ""
                    for chunk in response.chunks:
                        if chunk.type == "text":
                            full_content += chunk.text

                    me.text(
                        full_content,
                        style=me.Style(
                            white_space="pre-wrap",
                            font_family="monospace",
                            padding=me.Padding.all(8),
                            background=me.theme_var("surface-container"),
                            border_radius=4,
                        ),
                    )
                else:
                    me.text(
                        "No content in response chunks",
                        style=me.Style(
                            white_space="pre-wrap",
                            font_family="monospace",
                            padding=me.Padding.all(8),
                            background=me.theme_var("surface-container"),
                            border_radius=4,
                        ),
                    )
            else:
                # Show summary
                chunk_count = len(response.chunks)
                total_length = sum(
                    len(chunk.text)
                    if chunk.type == "text" and chunk.text
                    else 0
                    for chunk in response.chunks
                )
                me.text(
                    f"Chunks: {chunk_count}, Total length: {total_length} chars"
                )


def toggle_request(e: me.ClickEvent, call_id: int):
    state = me.state(LLMLogState)
    if call_id in state.expanded_request_ids:
        state.expanded_request_ids.remove(call_id)
    else:
        state.expanded_request_ids.append(call_id)


def toggle_response(e: me.ClickEvent, call_id: int):
    state = me.state(LLMLogState)
    if call_id in state.expanded_response_ids:
        state.expanded_response_ids.remove(call_id)
    else:
        state.expanded_response_ids.append(call_id)


def clear_llm_logs_handler(e: me.ClickEvent):
    llm_call_logger().clear_calls()
