import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, Field

from dyad.public.chat_message import ChatMessage
from dyad.public.input import Input

BaseModelType = TypeVar("BaseModelType", bound=BaseModel)


@dataclass
class LanguageModelRequest(Generic[BaseModelType]):
    """Chat request metadata."""

    input: Input
    language_model_id: str
    history: Sequence[ChatMessage] = field(default_factory=list)
    prediction: str | None = None
    system_prompt: str = ""
    output_type: type[BaseModelType] | None = None


class ChatTurn(BaseModel):
    """A single turn in the chat containing multiple messages
    (e.g. user re-generated a turn multiple times)."""

    messages: list[ChatMessage] = Field(default_factory=list)
    _current_message_index: int = -1

    @property
    def current_message_index(self) -> int:
        if self._current_message_index == -1:
            return len(self.messages) - 1
        return self._current_message_index

    @current_message_index.setter
    def current_message_index(self, index: int):
        self._current_message_index = index

    @property
    def current_message(self) -> ChatMessage:
        """Get the last message in the turn."""
        if self._current_message_index == -1:
            return self.messages[-1]
        return self.messages[self._current_message_index]

    def add_message(self, message: ChatMessage):
        """Add a message to the turn."""
        self.messages.append(message)


class Chat(BaseModel):
    """Entire chat consisting of multiple turns."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    turns: list[ChatTurn] = Field(default_factory=list)
    pad_ids: list[str] = Field(default_factory=list)

    @property
    def current_messages(self) -> list[ChatMessage]:
        """Get all the latest messages in the chat."""
        return [turn.current_message for turn in self.turns]

    def add_message(self, message: ChatMessage):
        """Add a message to the chat."""
        self.turns.append(ChatTurn())
        self.turns[-1].messages.append(message)


class Chats(BaseModel):
    """A collection of chat chats."""

    chats: list[Chat] = Field(default_factory=lambda: [Chat()])
    current_chat_index: int = 0

    def chat(self) -> Chat:
        """Get the last chat."""
        return self.chats[self.current_chat_index]


class ChatMetadata(BaseModel):
    """Metadata for a chat session."""

    id: str
    title: str
    updated_at: datetime
