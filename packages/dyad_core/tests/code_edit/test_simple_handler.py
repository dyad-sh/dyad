import os
from unittest.mock import patch

import pytest

# Set up environment variable before imports
os.environ["DYAD_WORKSPACE_DIR"] = "/tmp/test_workspace"

# Now do the imports
from unittest.mock import MagicMock

from dyad.apply_code import CodeEdit
from dyad.code_edit.simple_handler import (
    remove_code_fence,
    simple_apply_code_handler,
)
from dyad.public.chat_message import ErrorChunk, TextChunk


def test_remove_code_fence():
    assert (
        remove_code_fence("""
```python
def partial_code_block():
""")
        == "def partial_code_block():"
    )
    assert (
        remove_code_fence(
            """
```python
import json
import os
import time
from typing import TypedDict
"""
        )
        == """import json
import os
import time
from typing import TypedDict"""
    )

    # Test with no code fence
    input_text = "def hello():\n    print('world')"
    assert remove_code_fence(input_text) == input_text

    # Test with code fence
    input_with_fence = (
        "Some text\n```python\ndef hello():\n    print('world')\n```\nMore text"
    )
    expected = "def hello():\n    print('world')"
    assert remove_code_fence(input_with_fence) == expected

    # Test with empty content
    assert remove_code_fence("") == ""

    # Test with multiple code blocks - should handle all blocks
    multiple_blocks = "```python\nblock1\n```\ntext\n```python\nblock2\n```"
    assert remove_code_fence(multiple_blocks) == "block1\nblock2"

    # Test with multiple code blocks with different languages
    mixed_blocks = "```python\npy_code\n```\n```javascript\njs_code\n```"
    assert remove_code_fence(mixed_blocks) == "py_code\njs_code"

    # Test with code containing triple backticks
    code_with_backticks = (
        "```python\n"
        "def show_markdown():\n"
        "    example = '''```markdown\n"
        "    # Title\n"
        "    ```'''\n"
        "    print(example)\n"
        "```"
    )
    expected_with_backticks = (
        "def show_markdown():\n"
        "    example = '''```markdown\n"
        "    # Title\n"
        "    ```'''\n"
        "    print(example)"
    )
    assert remove_code_fence(code_with_backticks) == expected_with_backticks


@pytest.fixture
def mock_workspace():
    with (
        patch(
            "dyad.code_edit.simple_handler.does_workspace_file_exist"
        ) as mock_exists,
        patch("dyad.code_edit.simple_handler.read_workspace_file") as mock_read,
        patch(
            "dyad.code_edit.simple_handler.get_editor_language_model"
        ) as mock_model,
        patch(
            "dyad.code_edit.simple_handler.get_language_model_client"
        ) as mock_client,
        patch("dyad.code_edit.simple_handler.logger") as mock_logger,
    ):
        mock_exists.return_value = True
        mock_read.return_value = "original code"

        mock_model_instance = MagicMock()
        mock_model_instance.id = "test-model-id"
        mock_model.return_value = mock_model_instance

        mock_client_instance = MagicMock()
        mock_client.return_value = mock_client_instance

        yield {
            "exists": mock_exists,
            "read": mock_read,
            "model": mock_model,
            "client": mock_client_instance,
            "logger": mock_logger,
        }


def test_simple_apply_code_handler_file_not_exists(mock_workspace):
    mock_workspace["exists"].return_value = False
    code_edit = CodeEdit(
        file_path="test.py", code_edit="new code", edit_context="edit_context"
    )

    result = list(simple_apply_code_handler(code_edit))
    assert result == ["new code"]


def test_simple_apply_code_handler_success(mock_workspace):
    code_edit = CodeEdit(
        file_path="test.py", code_edit="new code", edit_context="edit_context"
    )

    # Mock the streaming response
    mock_workspace["client"].stream_chunks.return_value = [
        TextChunk(text="updated "),
        TextChunk(text="code"),
    ]

    result = list(simple_apply_code_handler(code_edit))
    assert result == ["updated ", "updated code"]


def test_simple_apply_code_handler_error(mock_workspace):
    code_edit = CodeEdit(
        file_path="test.py", code_edit="new code", edit_context="edit_context"
    )

    # Mock an error response
    mock_workspace["client"].stream_chunks.return_value = [
        ErrorChunk(message="Test error")
    ]

    with pytest.raises(Exception) as exc_info:
        list(simple_apply_code_handler(code_edit))

    # Updated assertion to match the actual error message format
    error_msg = str(exc_info.value)
    assert "Could not apply code edit because of" in error_msg
    assert "Test error" in error_msg


def test_simple_apply_code_handler_logging(mock_workspace):
    code_edit = CodeEdit(
        file_path="test.py", code_edit="new code", edit_context="edit_context"
    )
    mock_logger = mock_workspace["logger"]()

    mock_workspace["client"].stream_chunks.return_value = [
        TextChunk(text="code")
    ]
    list(simple_apply_code_handler(code_edit))

    # Verify debug logging
    mock_logger.debug.assert_called_once()
    assert "Applying code edit" in mock_logger.debug.call_args[0][0]
