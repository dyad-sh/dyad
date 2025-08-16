# Python RL Service

This directory contains the Python-based reinforcement learning service for the multi-agent system.

## Setup

1.  **Install system dependencies**:

    - On Debian/Ubuntu:
      ```bash
      sudo apt-get install libsdl2-dev
      ```
    - On macOS (using Homebrew):
      ```bash
      brew install sdl2
      ```

2.  **Create a virtual environment**:

    ```bash
    python -m venv venv
    ```

3.  **Activate the virtual environment**:

    - On Windows:
      ```bash
      .\venv\Scripts\activate
      ```
    - On macOS and Linux:
      ```bash
      source venv/bin/activate
      ```

4.  **Install the dependencies**:
    ```bash
    pip install -r requirements.txt
    ```

## Running the Service

To run the RL service, execute the following command:

```bash
python service.py
```

This will start a Flask server on `http://127.0.0.1:5001`.
