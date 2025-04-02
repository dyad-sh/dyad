import time
from collections.abc import Generator

import mesop as me
from dyad.agent_api.agent_context import AgentContext
from dyad.logging.analytics import analytics
from dyad.message_cache import message_cache
from dyad.public.chat_message import (
    ChatMessage,
    Content,
    ErrorChunk,
)
from dyad.settings.user_settings import get_user_settings
from dyad.storage.models.chat import save_chat

from dyad_app.chat_processor import generate_chat_response
from dyad_app.logic.chat_files import has_code_blocks
from dyad_app.ui.chat.message_parser import parse_content_with_pad
from dyad_app.ui.chat.pad_helpers import generate_id
from dyad_app.ui.side_pane_state import get_side_pane, set_side_pane
from dyad_app.ui.state import (
    State,
    set_current_chat,
    set_default_input_state,
)


def regenerate_response(
    turn_index: int,
    *,
    user_message_suffix: str = "",
    model_id: str | None = None,
) -> Generator[None, None, None]:
    state = me.state(State)

    # Get the message from the previous turn which should be a user message
    previous_turn = state.current_chat.turns[turn_index - 1]
    user_message = previous_turn.current_message
    # Get bot message to be regenerated
    current_turn = state.current_chat.turns[turn_index]
    assistant_message = ChatMessage(role="assistant")
    current_turn.add_message(assistant_message)
    _prepare_chat_state_for_response()
    yield

    # Send in the old user input and chat history to get the bot response.
    # We make sure to only pass in the chat history up to this message.
    yield from _handle_response(
        generate_chat_response(
            input=user_message.content.get_text() + user_message_suffix,
            history=state.current_chat.current_messages[: turn_index - 1],
            model_id=model_id,
        ),
        current_assistant_message=assistant_message,
        current_user_message=user_message,
    )


def submit_chat_msg() -> Generator[None, None, None]:
    """Handles submitting a chat message."""
    state = me.state(State)
    if state.in_progress or not state.input_state.raw_input:
        return
    analytics().record_send_chat_message()
    input_state = state.input_state
    input = input_state.raw_input
    # Clear side pane if needed.
    if get_side_pane() != "chat-files-overview":
        set_side_pane()

    output = state.current_chat
    user_message = ChatMessage(role="user", content=Content.from_text(input))
    output.add_message(user_message)
    _prepare_chat_state_for_response()

    # Send user input and chat history to get the bot response.
    assistant_message = ChatMessage(role="assistant")
    output.add_message(assistant_message)
    res = generate_chat_response(
        input,
        output.current_messages[:-2],
    )
    # Skip the last two messages which are the input and the newly added assistant message.
    # Reset the input state.
    set_default_input_state()
    state.input_state.clear_counter += 1
    yield

    yield from _handle_response(
        res,
        current_assistant_message=assistant_message,
        current_user_message=user_message,
    )


def click_update_edit_message(
    e: me.ClickEvent, turn_index: int
) -> Generator[None, None, None]:
    """Edits an existing user message and regenerates the subsequent bot response"""
    state = me.state(State)

    # Get the user message to edit
    current_turn = state.current_chat.turns[turn_index]
    user_message = current_turn.current_message
    user_message._is_editing = False

    # Get the subsequent bot turn that needs to be regenerated
    next_turn = state.current_chat.turns[turn_index + 1]
    assistant_message = ChatMessage(role="assistant")
    next_turn.add_message(assistant_message)
    assistant_message.content.set_text("")

    # Remove all subsequent turns
    state.current_chat.turns = state.current_chat.turns[: turn_index + 2]

    _prepare_chat_state_for_response()
    yield

    # Generate new response
    yield from _handle_response(
        generate_chat_response(
            user_message.content.get_text(),
            state.current_chat.current_messages[: turn_index + 1],
        ),
        current_assistant_message=assistant_message,
        current_user_message=user_message,
    )


def submit_follow_up_prompt(input: str) -> Generator[None, None, None]:
    """Handles submitting a chat message."""
    state = me.state(State)
    if state.in_progress:
        return
    user_message = ChatMessage(role="user", content=Content.from_text(input))
    state.current_chat.add_message(user_message)
    _prepare_chat_state_for_response()

    # Send user input and chat history to get the bot response.
    assistant_message = ChatMessage(role="assistant")
    state.current_chat.add_message(assistant_message)
    yield

    # Skip the last two messages which are the input and the newly added assistant message.
    yield from _handle_response(
        generate_chat_response(
            input,
            state.current_chat.current_messages[:-2],
        ),
        current_assistant_message=assistant_message,
        current_user_message=user_message,
    )


def _prepare_chat_state_for_response():
    state = me.state(State)
    state.in_progress = True
    state.enable_auto_scroll = True
    state.is_chat_cancelled = False
    state.scroll_counter += 1


def _handle_response(
    param: tuple[Generator[None, None, None], AgentContext],
    *,
    current_assistant_message: ChatMessage,
    current_user_message: ChatMessage,
):
    start_time = time.time()
    state = me.state(State)
    current_chat = state.current_chat
    response, context = param
    has_opened_side_pane = False
    try:
        for _ in response:
            if me.state(State).is_chat_cancelled:
                raise GeneratorExit
            current_assistant_message.content = context.content
            message_text = current_assistant_message.content.get_text()
            pad_id = generate_id()
            if parse_content_with_pad(message_text).has_pad():
                pad = parse_content_with_pad(message_text).get_first_pad()
                pad.id = pad_id
                # TODO: do not just hardcode to one
                state.current_chat.pad_ids = [pad_id]
                state.pad = pad
                # Don't auto-open pads.
                if (
                    not has_opened_side_pane
                    and get_user_settings().pad_mode == "all"
                ):
                    set_side_pane("pad")
                    has_opened_side_pane = True
            if has_code_blocks(message_text) > 0 and not has_opened_side_pane:
                set_side_pane("chat-files-overview")
                has_opened_side_pane = True

            if (time.time() - start_time) >= 0.40:
                start_time = time.time()
                yield

    except GeneratorExit:
        # Handle cancellation
        current_assistant_message.content.children[-1].append_chunk(
            ErrorChunk(message="Cancelled by user")
        )
    finally:
        message_cache().set(
            key=current_user_message.id,
            language_model_text=context.get_prompt(),
            pad_ids=context._pad_ids,
            files=context._observed_files,
        )
        # If the user hasn't moved to another chat (e.g. new chat),
        # then we'll set the current chat to update the query params.
        if state.current_chat == current_chat:
            set_current_chat(current_chat)
        save_chat(current_chat)
        state.in_progress = False
        state.is_chat_cancelled = False
        state.chat_input_focus_counter += 1
        yield
        time.sleep(0.4)
        state.enable_auto_scroll = False
        yield
