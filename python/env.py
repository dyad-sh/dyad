import gym
from gym import spaces

class CodeReviewEnv(gym.Env):
    def __init__(self):
        super(CodeReviewEnv, self).__init__()
        self.action_space = spaces.Text(max_length=2048, charset='utf-8')
        self.observation_space = spaces.Text(max_length=2048, charset='utf-8')
        self.task = "Create a function that adds two numbers."
        self.state = self.task
        self.max_turns = 5
        self.current_turn = 0

    def step(self, action):
        # In this simplified environment, the "reviewer" is a simple function
        # that checks if the generated code contains the keyword "add".

        self.current_turn += 1

        if "function add" in action:
            reward = 1.0
            done = True
            feedback = "LGTM! [APPROVED]"
        else:
            reward = 0.0
            done = self.current_turn >= self.max_turns
            feedback = "The code is not correct. Please try again."

        self.state = f"Task: {self.task}\nPrevious Code:\n{action}\nFeedback:\n{feedback}"

        return self.state, reward, done, {}

    def reset(self):
        self.state = self.task
        self.current_turn = 0
        return self.state

    def render(self, mode='human'):
        print(self.state)
