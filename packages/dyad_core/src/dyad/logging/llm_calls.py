import logging
from datetime import datetime
from typing import Optional

from pydantic import BaseModel
from sqlalchemy import delete
from sqlmodel import Field, Session, SQLModel, select

from dyad.chat import LanguageModelRequest
from dyad.logging.logs_sql_engine import engine
from dyad.public.chat_message import CompletionMetadataChunk, LanguageModelChunk


class LanguageModelResponse(BaseModel):
    chunks: list[LanguageModelChunk]

    def get_completion_metadata(self) -> CompletionMetadataChunk | None:
        for chunk in reversed(self.chunks):
            if chunk.type == "completion-metadata":
                return chunk


class LanguageModelCallsTable(SQLModel, table=True):
    id: int = Field(default=None, primary_key=True)
    timestamp: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    request_json: str
    response_json: str


class LanguageModelCallRecord(BaseModel):
    id: int
    timestamp: datetime
    request: LanguageModelRequest
    response: LanguageModelResponse


class LLMCallLogger:
    """
    Singleton class for logging LLM requests and responses to a database.
    """

    _instance: Optional["LLMCallLogger"] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def record_request(self, request: LanguageModelRequest) -> int:
        """
        Record an LLM request to the database.

        Args:
            request: The LanguageModelRequest to record

        Returns:
            The ID of the created record
        """

        # Create a new record with empty response for now
        with Session(engine) as session:
            record = LanguageModelCallsTable(
                timestamp=datetime.utcnow(),
                request_json=request.model_dump_json(),
                response_json="{}",
            )
            session.add(record)
            session.commit()
            session.refresh(record)
            return record.id

    def record_response(
        self, request_id: int, response: LanguageModelResponse
    ) -> None:
        """
        Record an LLM response to the database, updating the existing request record.

        Args:
            request_id: The ID of the request record to update
            response: The LanguageModelResponse to record
        """

        with Session(engine) as session:
            statement = select(LanguageModelCallsTable).where(
                LanguageModelCallsTable.id == request_id
            )
            results = session.exec(statement)
            record = results.first()

            if record:
                # Update the response
                record.response_json = response.model_dump_json()
                session.add(record)
                session.commit()
            else:
                raise ValueError(
                    f"Request ID {request_id} not found in database."
                )

    def get_recent_calls(
        self, limit: int = 20
    ) -> list[LanguageModelCallRecord]:
        """
        Retrieve the most recent LLM calls from the database in reverse chronological order.
        """

        with Session(engine) as session:
            statement = (
                select(LanguageModelCallsTable)
                .order_by(LanguageModelCallsTable.timestamp.desc())  # type: ignore
                .limit(limit)
            )
            results = session.exec(statement)
            call_records = []

            for db_record in results:
                try:
                    request = LanguageModelRequest.model_validate_json(
                        db_record.request_json
                    )
                    response = LanguageModelResponse.model_validate_json(
                        db_record.response_json
                    )

                    call_record = LanguageModelCallRecord(
                        id=db_record.id,
                        timestamp=db_record.timestamp,
                        request=request,
                        response=response,
                    )
                    call_records.append(call_record)
                except Exception as e:
                    logging.error(f"Error parsing record {db_record.id}: {e!s}")
                    continue

            return call_records

    def clear_calls(self) -> None:
        with Session(engine) as session:
            session.exec(delete(LanguageModelCallsTable))  # type: ignore
            session.commit()


def llm_call_logger() -> LLMCallLogger:
    return LLMCallLogger()
