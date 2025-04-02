import uuid
from datetime import datetime
from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, TypeAdapter
from typing_extensions import TypeVar

from dyad.message_cache import message_cache
from dyad.public.agent_step import AgentStep, DefaultStep, ToolId
from dyad.public.part import Part, TextPart


class LanguageModelFinishReason(Enum):
    """Enum for the reason why the language model stopped generating."""

    STOP = "stop"
    MAX_TOKENS = "max_tokens"
    OTHER = "other"
    UNKNOWN = "unknown"


class CompletionMetadataChunk(BaseModel):
    """Chat usage metadata."""

    type: Literal["completion-metadata"] = "completion-metadata"
    input_tokens_count: int = 0
    cached_input_tokens_count: int = 0
    output_tokens_count: int = 0
    finish_reason: LanguageModelFinishReason = LanguageModelFinishReason.UNKNOWN

    class Config:
        frozen = True


class ErrorChunk(BaseModel):
    type: Literal["error"] = "error"
    message: str

    class Config:
        frozen = True


class TextChunk(BaseModel):
    type: Literal["text"] = "text"
    text: str = ""

    class Config:
        frozen = True


LanguageModelChunk = Annotated[
    TextChunk | ErrorChunk | CompletionMetadataChunk,
    Field(discriminator="type"),
]

AgentChunk = Annotated[TextChunk | ErrorChunk, Field(discriminator="type")]

T = TypeVar("T", bound=BaseModel)


class FileCheckpoint(BaseModel):
    original_path: str
    checkpoint_path: str
    timestamp: datetime


class Checkpoint(BaseModel):
    files: list[FileCheckpoint] = Field(default_factory=list)


class ContentError(BaseModel):
    message: str
    source: Literal["user", "system"] = "system"


class LanguageModelCallMetadata(BaseModel):
    input_tokens_count: int = 0
    cached_input_tokens_count: int = 0
    output_tokens_count: int = 0
    language_model_id: str = "<unset>"
    started_at: datetime | None = None
    ended_at: datetime | None = None
    finish_reason: LanguageModelFinishReason = LanguageModelFinishReason.UNKNOWN

    @property
    def seconds_taken(self) -> float:
        if self.started_at is None or self.ended_at is None:
            return -1
        return (self.ended_at - self.started_at).total_seconds()


class ContentMetadata(BaseModel):
    calls: list[LanguageModelCallMetadata] = Field(default_factory=list)


class Content(BaseModel):
    @staticmethod
    def from_text(text: str) -> "Content":
        """Create a chat content object from text."""
        return Content(parts=[TextPart(text=text)])

    internal_data: Any | None = Field(default=None)

    def set_data(self, value: BaseModel) -> None:
        self.internal_data = value

    def data_of(self, typeclass: type[T]) -> T:
        if self.internal_data is None:
            raise ValueError("Data is not set")
        return TypeAdapter(typeclass).validate_python(self.internal_data)

    parts: list[Part] = Field(default_factory=list)
    errors: list[ContentError] = Field(default_factory=list)
    metadata: ContentMetadata = Field(default_factory=ContentMetadata)

    internal_children: list["Content"] = Field(default_factory=list)
    internal_tool_render_id: ToolId | None = None
    internal_checkpoint: Checkpoint | None = None

    _is_loading: bool = True

    @property
    def children(self) -> list["Content"]:
        return self.internal_children

    @property
    def is_loading(self) -> bool:
        if self.children:
            return False
        if self.internal_data:
            return False
        if not self._is_loading:
            return False
        if self.errors:
            self._is_loading = False
            return False
        self._is_loading = not bool(self.get_text())
        return self._is_loading

    step: AgentStep = Field(default_factory=DefaultStep)

    def add_child(self, child: "Content"):
        """Add a child to the chat content."""
        self.children.append(child)

    def set_text(self, text: str):
        """Set the text content of the chat."""
        self.parts = [TextPart(text=text)]

    def get_direct_text(self) -> str:
        """Get the text content of the chat."""
        return "".join(
            [part.text for part in self.parts if isinstance(part, TextPart)]
        )

    def get_text(self) -> str:
        """Get the text content of the chat."""
        text = self.get_direct_text() + "".join(
            [child.get_text() for child in self.children]
        )
        if text:
            return text
        if self.internal_data:
            return str(self.internal_data)
        return ""

    def append_chunk(self, chunk: AgentChunk):
        """Append a chunk to the chat content."""
        if isinstance(chunk, ErrorChunk):
            self.errors.append(ContentError(message=chunk.message))
        elif isinstance(chunk, TextChunk):
            if self.parts and isinstance(self.parts[-1], TextPart):
                self.parts[-1] = TextPart(text=self.parts[-1].text + chunk.text)
            else:
                self.parts.append(TextPart(text=chunk.text))
        else:
            raise ValueError(f"Unknown chunk type: {chunk}")


Role = Literal["user", "assistant"]


class ChatMessage(BaseModel):
    """Chat message metadata."""

    role: Role = "user"
    content: Content = Field(default_factory=Content)
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    _is_editing: bool = False

    def to_language_model_text(self) -> str:
        cached_message = message_cache().get(self.id)
        if cached_message:
            return cached_message.language_model_text

        return self.content.get_text()
