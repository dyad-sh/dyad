import pytest
from env import CodeReviewEnv

def test_env_initialization():
    env = CodeReviewEnv()
    assert env.task == "Create a function that adds two numbers."
    assert env.state == env.task

def test_env_step_correct():
    env = CodeReviewEnv()
    action = "function add(a, b) { return a + b; }"
    state, reward, done, _ = env.step(action)
    assert reward == 1.0
    assert done is True
    assert "LGTM! [APPROVED]" in state

def test_env_step_incorrect():
    env = CodeReviewEnv()
    action = "function subtract(a, b) { return a - b; }"
    state, reward, done, _ = env.step(action)
    assert reward == 0.0
    assert done is False
    assert "The code is not correct" in state

def test_env_reset():
    env = CodeReviewEnv()
    env.step("some action")
    state = env.reset()
    assert state == env.task
    assert env.current_turn == 0
