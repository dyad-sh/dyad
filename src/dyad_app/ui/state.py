import time
from dataclasses import dataclass
from typing import Literal

import mesop as me
from dyad.apply_code import (
    ApplyCodeCandidate,
    CodeEdit,
)
from dyad.chat import (
    Chat,
)
from dyad.logging.analytics import analytics
from dyad.pad import Pad
from dyad.settings.workspace_settings import get_workspace_settings
from dyad.status.status import Status
from dyad.suggestions import SuggestionsQuery
from pydantic import BaseModel, Field

from dyad_app.ui.side_pane_type import SidePane


@dataclass
class FileCodeState:
    """Represents the code state for a single file."""

    plan: CodeEdit | None = None
    candidate: ApplyCodeCandidate | None = None


class MessageOrigin(BaseModel):
    chat_id: str = ""
    turn_index: int = 0
    message_index: int = 0


class ApplyCodeState(BaseModel):
    file_states: dict[str, FileCodeState] = {}
    origin: MessageOrigin = Field(default_factory=MessageOrigin)


class CodeTodo(BaseModel):
    text: str
    code_context: str
    line_range: tuple[int, int] = (1, 1)


class OpenedFile(BaseModel):
    path: str = ""
    contents: str = ""
    selected_todo_index: int | None = None
    todos: list[CodeTodo] = []


class InputState(BaseModel):
    raw_input: str = ""
    json_input: str = ""
    suggestions_query: SuggestionsQuery | None = None
    clear_counter: int = 0


class AccountState(BaseModel):
    authenticated_status: Literal[
        "loading", "authenticated", "unauthenticated"
    ] = "loading"
    subscription_status: Literal["loading", "paid", "unpaid"] = "loading"
    budget_renewal_date: str = ""
    remaining_budget_percentage: float = 0
    email: str = ""
    access_token: str | None = None
    error_message: str = ""


class AcademyCollection(BaseModel):
    title: str
    description: str
    id: str


class AcademyData(BaseModel):
    collections: list[AcademyCollection] = []

    def get_collection(self, id: str) -> AcademyCollection | None:
        return next(
            (
                collection
                for collection in self.collections
                if collection.id == id
            ),
            None,
        )


@me.stateclass
class State:
    status_by_type: dict[str, Status]
    academy_data: AcademyData
    side_pane_open: SidePane = ""
    input_state: InputState
    top_error_message: str
    apply_code_state: ApplyCodeState
    page: Literal["chat", "settings", "pads"] = "chat"
    current_chat: Chat
    pad: Pad | None = None
    # Make sure pad is registered
    __pad_sentinel: Pad = None  # type: ignore

    in_progress: bool
    enable_auto_scroll: bool
    is_chat_cancelled: bool
    account_state: AccountState
    chat_input_focus_counter: int = 0
    scroll_counter: int = 0
    chat_files: list[str]
    side_pane_file: OpenedFile
    todos_collapsed: bool = False


def set_current_chat(chat: Chat):
    state = me.state(State)
    state.current_chat = chat
    query_params = {}
    if chat.turns:
        query_params["c"] = chat.id

    me.navigate("/", query_params=query_params)
    state.top_error_message = ""


def new_chat(*, record_analytics: bool = True):
    """Resets messages."""
    state = me.state(State)
    set_current_chat(Chat(turns=[]))
    set_default_input_state()
    state.is_chat_cancelled = True
    state.chat_input_focus_counter += 1
    if record_analytics:
        analytics().record_create_chat()


def set_default_input_state():
    state = me.state(State)
    if get_workspace_settings().last_agent_used:
        state.input_state.raw_input = (
            f"@{get_workspace_settings().last_agent_used} "
        )
    else:
        state.input_state.raw_input = ""


def focus_chat_input():
    state = me.state(State)
    state.chat_input_focus_counter += 1


def navigate_and_cancel_chat(url: str):
    state = me.state(State)
    state.is_chat_cancelled = True
    yield
    time.sleep(0.1)
    me.navigate(url)
    yield
