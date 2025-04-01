import json
import urllib.error
from unittest.mock import MagicMock, patch

import pytest
from dyad_cli import (
    EXTENSIONS_REQUIREMENTS_PATH,
    CliConfig,
    __version__,
    check_package_version,
    fetch_package_version,
    fetch_versions,
    get_command_args,
)


# Add mock_env fixture
@pytest.fixture
def mock_env(monkeypatch):
    """Mock environment variables."""
    monkeypatch.setenv("DYAD_CLI_PACKAGE_NAME", "dyad")
    monkeypatch.setenv("DYAD_APP_PACKAGE_NAME", "dyad_app")
    return monkeypatch


def test_fetch_package_version_success():
    """Test successful package version fetch."""
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.__enter__ = lambda x: x
    mock_response.__exit__ = MagicMock()
    mock_response.read.return_value = json.dumps(
        {"info": {"version": "1.0.0"}}
    ).encode()

    with patch("urllib.request.urlopen", return_value=mock_response):
        version = fetch_package_version("test-package")
        assert version == "1.0.0"


def test_fetch_package_version_network_error():
    """Test handling of network errors with retry."""
    with patch(
        "urllib.request.urlopen",
        side_effect=urllib.error.URLError("Network error"),
    ):
        with patch("time.sleep"):  # Don't actually sleep in tests
            version = fetch_package_version("test-package")
            assert version is None


def test_fetch_package_version_timeout():
    """Test handling of timeout errors with retry."""
    with patch("urllib.request.urlopen", side_effect=TimeoutError()):
        with patch("time.sleep"):  # Don't actually sleep in tests
            version = fetch_package_version("test-package")
            assert version is None


def test_fetch_versions_success():
    """Test successful concurrent version fetching."""
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.__enter__ = lambda x: x
    mock_response.__exit__ = MagicMock()
    mock_response.read.return_value = json.dumps(
        {"info": {"version": "1.0.0"}}
    ).encode()

    with patch("urllib.request.urlopen", return_value=mock_response):
        cli_version, app_version = fetch_versions()
        assert cli_version == "1.0.0"
        assert app_version == "1.0.0"


def test_fetch_versions_partial_failure():
    """Test when one fetch succeeds and one fails."""
    success_response = MagicMock()
    success_response.status = 200
    success_response.__enter__ = lambda x: x
    success_response.__exit__ = MagicMock()
    success_response.read.return_value = json.dumps(
        {"info": {"version": "1.0.0"}}
    ).encode()

    def mock_urlopen(url, *args, **kwargs):
        if "dyad_app" in url:
            raise urllib.error.URLError("Network error")
        return success_response

    with patch("urllib.request.urlopen", side_effect=mock_urlopen):
        with patch("time.sleep"):  # Don't actually sleep in tests
            cli_version, app_version = fetch_versions()
            assert cli_version == "1.0.0"
            assert app_version is None


@patch("dyad_cli.fetch_package_version")
def test_check_package_version_latest_already(mock_fetch, mock_env):
    """Test scenario where current_version == latest_version from PyPI."""
    config: CliConfig = {"skip_updates_for_version": ""}
    result = check_package_version(
        latest_version=__version__,
        cli_config=config,
        current_version=__version__,
    )
    assert result == "latest-version-already"


@patch("dyad_cli.fetch_package_version")
def test_check_package_version_already_skipped(mock_fetch, mock_env):
    """Test scenario where the user has previously skipped the latest version."""
    latest_version = "1.2.3"
    config: CliConfig = {"skip_updates_for_version": latest_version}
    result = check_package_version(
        latest_version=latest_version,
        cli_config=config,
        current_version="1.0.0",
    )
    assert result == "upgrade-skipped-previously"


@patch("sys.exit")
def test_check_package_version_success_upgrade(
    mock_exit, mock_env, monkeypatch
):
    """Test successful upgrade scenario."""
    mock_input = MagicMock(return_value="y")
    mock_install = MagicMock()
    config: CliConfig = {"skip_updates_for_version": ""}

    check_package_version(
        latest_version="1.2.3",
        cli_config=config,
        current_version="1.0.0",
        input_fn=mock_input,
        install_fn=mock_install,
    )

    mock_install.assert_called_once()
    mock_exit.assert_called_once_with(0)


def test_check_package_version_user_skips(mock_env):
    """Test when user chooses to skip the upgrade."""
    mock_input = MagicMock(return_value="n")
    mock_save = MagicMock()

    result = check_package_version(
        latest_version="1.2.3",
        cli_config={"skip_updates_for_version": ""},
        current_version="1.0.0",
        input_fn=mock_input,
        save_prefs_fn=mock_save,
    )
    assert result == "user-skipped"
    mock_save.assert_called_once()


def test_get_command_args_no_extensions(mock_env, tmp_path):
    """Test command args generation without extensions."""
    # Use a temporary path instead of the real EXTENSIONS_REQUIREMENTS_PATH
    with patch(
        "dyad_cli.EXTENSIONS_REQUIREMENTS_PATH", tmp_path / "requirements.txt"
    ):
        # Make sure the temp file doesn't exist
        if (tmp_path / "requirements.txt").exists():
            (tmp_path / "requirements.txt").unlink()

        result = get_command_args("uv", "1.0.0", [])
        assert "--with-requirements" not in result


def test_get_command_args_with_extensions(mock_env):
    """Test command args generation with extensions."""
    EXTENSIONS_REQUIREMENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    EXTENSIONS_REQUIREMENTS_PATH.touch()

    result = get_command_args("uv", "1.0.0", [])
    assert "--with-requirements" in result
    assert str(EXTENSIONS_REQUIREMENTS_PATH) in result


def test_get_command_args_offline_mode(mock_env):
    """Test command args generation in offline mode."""
    result = get_command_args("uv", None, [], is_offline=True)
    assert "--offline" in result


def test_get_command_args_with_refresh_extensions(mock_env):
    """Test command args generation with refresh extensions flag."""
    result = get_command_args("uv", "1.0.0", [], refresh_extensions=True)
    assert "--refresh" in result


def test_get_command_args_no_refresh_without_requirements(mock_env):
    """Test no refresh when requirements file doesn't exist."""
    if EXTENSIONS_REQUIREMENTS_PATH.exists():
        EXTENSIONS_REQUIREMENTS_PATH.unlink()

    result = get_command_args("uv", "1.0.0", [])
    assert "--refresh" not in result


def test_get_command_args_no_refresh_by_default(mock_env):
    """Test refresh flag is not present by default."""
    result = get_command_args("uv", "1.0.0", [])
    assert "--refresh" not in result


def test_get_command_args_with_prerelease(mock_env):
    """Test command args generation with pre-release flag."""
    result = get_command_args("uv", "1.0.0", [], allow_prerelease=True)
    assert "--prerelease" in result


def test_get_command_args_without_prerelease(mock_env):
    """Test command args generation without pre-release flag."""
    result = get_command_args("uv", "1.0.0", [])
    assert "--prerelease" not in result
